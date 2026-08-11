/*
 * Freestanding ESP32-S2 TIE instruction smoke test.
 *
 * QEMU Xtensa semihosting uses a2 for the syscall number and a3 for the
 * status. A zero process status means that every dedicated-GPIO instruction
 * decoded and produced the expected value.
 */

    .section .reset, "ax"
    .global _reset
    .type _reset, @function

_reset:
    j       _start
    .size _reset, . - _reset

    .section .text.start, "ax"
    .global _start
    .type _start, @function

_start:
    movi    a2, 0xa5
    wur.gpio_out a2
    rur.gpio_out a6
    movi    a7, 0xa5
    bne     a6, a7, .Lfail_1

    set_bit_gpio_out 0x12
    rur.gpio_out a6
    movi    a7, 0xb7
    bne     a6, a7, .Lfail_2

    clr_bit_gpio_out 0x84
    rur.gpio_out a6
    movi    a7, 0x33
    bne     a6, a7, .Lfail_3

    movi    a2, 0xc0
    movi    a3, 0xf0
    wr_mask_gpio_out a2, a3
    rur.gpio_out a6
    movi    a7, 0xc3
    bne     a6, a7, .Lfail_4

    get_gpio_in a6
    bnez    a6, .Lfail_5

    movi    a3, 0
    j       .Lexit

.Lfail_1:
    movi    a3, 1
    j       .Lexit
.Lfail_2:
    movi    a3, 2
    j       .Lexit
.Lfail_3:
    movi    a3, 3
    j       .Lexit
.Lfail_4:
    movi    a3, 4
    j       .Lexit
.Lfail_5:
    movi    a3, 5

.Lexit:
    movi    a2, 1
    simcall

    .size _start, . - _start
