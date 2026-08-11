/*
 * Circuit Design Harness simavr trace runner.
 *
 * This program is built against the repository-pinned simavr source and is
 * distributed under GPL-3.0-or-later, matching simavr's license.
 */

#include <errno.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "avr_ioport.h"
#include "avr_uart.h"
#include "sim_avr.h"
#include "sim_elf.h"
#include "sim_hex.h"
#include "sim_irq.h"

#define TRACE_PREFIX "CDH_TRACE_V1 "
#define CLOCK_HZ 16000000U
#define MAX_PIN_EVENTS 8192U
#define MAX_UART_EVENTS 8192U

typedef struct {
    uint64_t cycle;
    uint8_t pin_index;
    uint8_t level;
} pin_event_t;

typedef struct {
    uint64_t cycle;
    uint8_t byte;
} uart_event_t;

typedef struct trace_state trace_state_t;

typedef struct {
    trace_state_t *trace;
    uint8_t index;
    char port;
    uint8_t bit;
} pin_context_t;

typedef struct {
    trace_state_t *trace;
    char port;
    uint8_t ddr;
} port_context_t;

struct trace_state {
    avr_t *avr;
    pin_event_t pin_events[MAX_PIN_EVENTS];
    uart_event_t uart_events[MAX_UART_EVENTS];
    uint32_t pin_event_count;
    uint32_t uart_event_count;
    uint8_t pin_truncated;
    uint8_t uart_truncated;
    uint8_t final_level[20];
    uint8_t final_known[20];
    pin_context_t pins[20];
    port_context_t ports[3];
};

static const char *PIN_NAMES[20] = {
    "D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9",
    "D10", "D11", "D12", "D13", "A0", "A1", "A2", "A3", "A4", "A5"
};

static const char PIN_PORTS[20] = {
    'D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'B', 'B',
    'B', 'B', 'B', 'B', 'C', 'C', 'C', 'C', 'C', 'C'
};

static const uint8_t PIN_BITS[20] = {
    0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5
};

static port_context_t *find_port(trace_state_t *trace, char port)
{
    for (size_t i = 0; i < 3; i++) {
        if (trace->ports[i].port == port) {
            return &trace->ports[i];
        }
    }
    return NULL;
}

static void append_pin_event(trace_state_t *trace, uint8_t pin_index, uint8_t level)
{
    trace->final_known[pin_index] = 1;
    trace->final_level[pin_index] = level;
    if (trace->pin_event_count >= MAX_PIN_EVENTS) {
        trace->pin_truncated = 1;
        return;
    }
    pin_event_t *event = &trace->pin_events[trace->pin_event_count++];
    event->cycle = trace->avr->cycle;
    event->pin_index = pin_index;
    event->level = level;
}

static void pin_changed(struct avr_irq_t *irq, uint32_t value, void *parameter)
{
    (void)irq;
    pin_context_t *pin = parameter;
    port_context_t *port = find_port(pin->trace, pin->port);
    if (port && (port->ddr & (1U << pin->bit))) {
        append_pin_event(pin->trace, pin->index, value & 1U);
    }
}

static void direction_changed(struct avr_irq_t *irq, uint32_t value, void *parameter)
{
    (void)irq;
    port_context_t *port = parameter;
    uint8_t previous = port->ddr;
    port->ddr = value & 0xffU;
    uint8_t newly_output = port->ddr & (uint8_t)~previous;
    for (uint8_t i = 0; i < 20; i++) {
        pin_context_t *pin = &port->trace->pins[i];
        if (pin->port == port->port && (newly_output & (1U << pin->bit))) {
            avr_irq_t *pin_irq = avr_io_getirq(
                port->trace->avr,
                AVR_IOCTL_IOPORT_GETIRQ(pin->port),
                pin->bit
            );
            if (pin_irq) {
                append_pin_event(port->trace, pin->index, pin_irq->value & 1U);
            }
        }
    }
}

static void uart_output(struct avr_irq_t *irq, uint32_t value, void *parameter)
{
    (void)irq;
    trace_state_t *trace = parameter;
    if (trace->uart_event_count >= MAX_UART_EVENTS) {
        trace->uart_truncated = 1;
        return;
    }
    uart_event_t *event = &trace->uart_events[trace->uart_event_count++];
    event->cycle = trace->avr->cycle;
    event->byte = value & 0xffU;
}

static void refresh_final_outputs(trace_state_t *trace)
{
    avr_ioport_state_t states[3] = {0};
    for (size_t i = 0; i < 3; i++) {
        avr_ioctl(
            trace->avr,
            AVR_IOCTL_IOPORT_GETSTATE(trace->ports[i].port),
            &states[i]
        );
    }
    for (uint8_t i = 0; i < 20; i++) {
        trace->final_known[i] = 0;
        for (size_t p = 0; p < 3; p++) {
            if (states[p].name == PIN_PORTS[i] && (states[p].ddr & (1U << PIN_BITS[i]))) {
                trace->final_known[i] = 1;
                trace->final_level[i] = (states[p].pin >> PIN_BITS[i]) & 1U;
                break;
            }
        }
    }
}

static int parse_duration(const char *raw, uint64_t *duration_us)
{
    char *end = NULL;
    errno = 0;
    unsigned long long value = strtoull(raw, &end, 10);
    if (errno != 0 || !end || *end != '\0' || value < 1000ULL || value > 5000000ULL) {
        return -1;
    }
    *duration_us = (uint64_t)value;
    return 0;
}

static void emit_trace(const trace_state_t *trace, uint64_t duration_us, const char *termination)
{
    printf(TRACE_PREFIX "{\"schemaVersion\":1,\"targetId\":\"arduino_uno_r3\","
           "\"engine\":\"simavr\",\"clockHz\":%u,\"requestedDurationMicros\":%" PRIu64
           ",\"cyclesExecuted\":%" PRIu64 ",\"termination\":\"%s\",",
           CLOCK_HZ, duration_us, (uint64_t)trace->avr->cycle, termination);

    printf("\"pinEvents\":[");
    for (uint32_t i = 0; i < trace->pin_event_count; i++) {
        const pin_event_t *event = &trace->pin_events[i];
        printf("%s{\"cycle\":%" PRIu64 ",\"pin\":\"%s\",\"level\":%u}",
               i ? "," : "", event->cycle, PIN_NAMES[event->pin_index], event->level);
    }
    printf("],\"finalPins\":{");
    int emitted = 0;
    for (uint8_t i = 0; i < 20; i++) {
        if (trace->final_known[i]) {
            printf("%s\"%s\":%u", emitted ? "," : "", PIN_NAMES[i], trace->final_level[i]);
            emitted = 1;
        }
    }
    printf("},\"uartEvents\":[");
    for (uint32_t i = 0; i < trace->uart_event_count; i++) {
        const uart_event_t *event = &trace->uart_events[i];
        printf("%s{\"cycle\":%" PRIu64 ",\"uart\":\"UART0\",\"byte\":%u}",
               i ? "," : "", event->cycle, event->byte);
    }
    printf("],\"pinEventsTruncated\":%s,\"uartEventsTruncated\":%s}\n",
           trace->pin_truncated ? "true" : "false",
           trace->uart_truncated ? "true" : "false");
}

int main(int argc, char **argv)
{
    if (argc != 3) {
        fprintf(stderr, "Usage: %s <firmware.elf|firmware.hex> <virtual-duration-microseconds>\n", argv[0]);
        return 2;
    }

    uint64_t duration_us = 0;
    if (parse_duration(argv[2], &duration_us) != 0) {
        fprintf(stderr, "Virtual duration must be an integer from 1000 to 5000000 microseconds.\n");
        return 2;
    }

    elf_firmware_t firmware = {0};
    snprintf(firmware.mmcu, sizeof(firmware.mmcu), "%s", "atmega328p");
    firmware.frequency = CLOCK_HZ;
    sim_setup_firmware(argv[1], AVR_SEGMENT_OFFSET_FLASH, &firmware, argv[0]);
    snprintf(firmware.mmcu, sizeof(firmware.mmcu), "%s", "atmega328p");
    firmware.frequency = CLOCK_HZ;

    avr_t *avr = avr_make_mcu_by_name(firmware.mmcu);
    if (!avr) {
        fprintf(stderr, "Pinned simavr does not provide atmega328p.\n");
        return 4;
    }
    avr_init(avr);
    avr->log = LOG_ERROR;
    avr_load_firmware(avr, &firmware);

    trace_state_t trace = {0};
    trace.avr = avr;
    const char ports[3] = {'B', 'C', 'D'};
    for (size_t i = 0; i < 3; i++) {
        trace.ports[i].trace = &trace;
        trace.ports[i].port = ports[i];
        avr_ioport_state_t state = {0};
        if (avr_ioctl(avr, AVR_IOCTL_IOPORT_GETSTATE(ports[i]), &state) == 0) {
            trace.ports[i].ddr = state.ddr;
        }
        avr_irq_t *direction = avr_io_getirq(
            avr,
            AVR_IOCTL_IOPORT_GETIRQ(ports[i]),
            IOPORT_IRQ_DIRECTION_ALL
        );
        if (direction) {
            avr_irq_register_notify(direction, direction_changed, &trace.ports[i]);
        }
    }
    for (uint8_t i = 0; i < 20; i++) {
        trace.pins[i].trace = &trace;
        trace.pins[i].index = i;
        trace.pins[i].port = PIN_PORTS[i];
        trace.pins[i].bit = PIN_BITS[i];
        avr_irq_t *pin = avr_io_getirq(
            avr,
            AVR_IOCTL_IOPORT_GETIRQ(PIN_PORTS[i]),
            PIN_BITS[i]
        );
        if (pin) {
            avr_irq_register_notify(pin, pin_changed, &trace.pins[i]);
        }
    }
    avr_irq_t *uart = avr_io_getirq(avr, AVR_IOCTL_UART_GETIRQ('0'), UART_IRQ_OUTPUT);
    if (uart) {
        avr_irq_register_notify(uart, uart_output, &trace);
    }

    uint64_t target_cycles = (duration_us * CLOCK_HZ) / 1000000ULL;
    int state = cpu_Running;
    while ((uint64_t)avr->cycle < target_cycles) {
        state = avr_run(avr);
        if (state == cpu_Done || state == cpu_Crashed) {
            break;
        }
    }

    const char *termination = state == cpu_Crashed ? "cpu_crashed"
        : state == cpu_Done ? "firmware_stopped"
        : "duration_reached";
    refresh_final_outputs(&trace);
    emit_trace(&trace, duration_us, termination);
    avr_terminate(avr);
    return state == cpu_Crashed ? 5 : 0;
}
