#include <stdint.h>

#define MMIO32(address) (*(volatile uint32_t *)(address))
#define GPIO_BASE 0x3f404000
#define GPIO_PIN_CONFIG(pin) (GPIO_BASE + 0x74 + (pin) * 4)
#define GPIO_OUTPUT_SELECT(pin) (GPIO_BASE + 0x554 + (pin) * 4)
#define EXTMEM_BASE 0x61800000
#define MMU_TABLE 0x61801000
#define MMU_ENTRY(index) (MMU_TABLE + (index) * 4)

__attribute__((section(".rom.rodata"), used))
static const uint32_t rom_alias_signature = 0x5a2d90c7;

static inline __attribute__((always_inline, noreturn)) void finish(uint32_t status)
{
    register uint32_t syscall_number asm("a2") = 1;
    register uint32_t exit_status asm("a3") = status;
    asm volatile("simcall" : "+r"(syscall_number), "+r"(exit_status));
    __builtin_unreachable();
}

void _start(void)
{
    if (*(volatile const uint32_t *)&rom_alias_signature != 0x5a2d90c7) {
        finish(30);
    }
    if (MMIO32(0x3f408038) != 0x1) {
        finish(33);
    }
    MMIO32(0x3f408050) = 0x8495a6b7;
    if (MMIO32(0x3f408050) != 0x8495a6b7) {
        finish(34);
    }
    MMIO32(0x3f402000) = 1U << 20;
    if (MMIO32(0x3f402000) != 0) {
        finish(35);
    }

    MMIO32(0x40022000) = 0x51a2b3c4;
    if (MMIO32(0x3ffb2000) != 0x51a2b3c4) {
        finish(1);
    }

    MMIO32(0x40070100) = 0x1234abcd;
    if (MMIO32(0x3ff9e100) != 0x1234abcd) {
        finish(2);
    }

    if (MMIO32(0x3f4c2000 + 37 * 4) != 6) {
        finish(3);
    }
    MMIO32(0x3f4c2000 + 37 * 4) = 5;
    if (MMIO32(0x3f4c2000 + 37 * 4) != 5) {
        finish(4);
    }

    if (MMIO32(0x3f400024) != 0x0000c060) {
        finish(5);
    }
    if (MMIO32(0x3f40005c) != 0x000a0012) {
        finish(6);
    }

    MMIO32(0x3f400024) = 0x80000604;
    MMIO32(0x3f40005c) = 0x00110012;
    if (MMIO32(0x3f400024) != 0x80000604) {
        finish(7);
    }
    if (MMIO32(0x3f40005c) != 0x00110012) {
        finish(8);
    }
    if (MMIO32(0x60000024) != 0x80000604 ||
        MMIO32(0x6000005c) != 0x00110012) {
        finish(31);
    }
    MMIO32(0x60000024) = 0x0000c060;
    if (MMIO32(0x3f400024) != 0x0000c060) {
        finish(32);
    }

    if (MMIO32(GPIO_BASE + 0x04) != 0 || MMIO32(GPIO_BASE + 0x20) != 0) {
        finish(9);
    }
    if (MMIO32(GPIO_BASE + 0x38) != 0x8 || MMIO32(GPIO_BASE + 0x62c) != 1 ||
        MMIO32(GPIO_BASE + 0x6fc) != 0x01905061) {
        finish(10);
    }
    if (MMIO32(GPIO_OUTPUT_SELECT(0)) != 0x100 ||
        MMIO32(GPIO_OUTPUT_SELECT(53)) != 0x100) {
        finish(11);
    }

    /* Direct software GPIO requires signal 256 and GPIO-controlled OEN. */
    MMIO32(GPIO_OUTPUT_SELECT(0)) = 0x500;
    MMIO32(GPIO_BASE + 0x08) = 1;
    MMIO32(GPIO_BASE + 0x24) = 1;
    if ((MMIO32(GPIO_BASE + 0x3c) & 1) == 0) {
        finish(12);
    }

    /* GPIO22-25 are absent, even though the inherited register bank has bits. */
    MMIO32(GPIO_OUTPUT_SELECT(22)) = 0x500;
    MMIO32(GPIO_BASE + 0x08) = 1U << 22;
    MMIO32(GPIO_BASE + 0x24) = 1U << 22;
    if (MMIO32(GPIO_BASE + 0x3c) & (1U << 22)) {
        finish(13);
    }

    /* GPIO46 is physically valid but input-only. */
    MMIO32(GPIO_OUTPUT_SELECT(46)) = 0x500;
    MMIO32(GPIO_BASE + 0x14) = 1U << 14;
    MMIO32(GPIO_BASE + 0x30) = 1U << 14;
    if (MMIO32(GPIO_BASE + 0x40) & (1U << 14)) {
        finish(14);
    }

    /* The upper data bank begins at GPIO32. */
    MMIO32(GPIO_OUTPUT_SELECT(32)) = 0x500;
    MMIO32(GPIO_BASE + 0x14) = 1;
    MMIO32(GPIO_BASE + 0x30) = 1;
    if ((MMIO32(GPIO_BASE + 0x40) & 1) == 0) {
        finish(15);
    }
    MMIO32(GPIO_BASE + 0x18) = 1;
    if (MMIO32(GPIO_BASE + 0x40) & 1) {
        finish(16);
    }

    /* Push-pull high becomes released-low when open-drain is selected. */
    MMIO32(GPIO_PIN_CONFIG(0)) = 1U << 2;
    if (MMIO32(GPIO_BASE + 0x3c) & 1) {
        finish(17);
    }
    MMIO32(GPIO_PIN_CONFIG(0)) = 0;
    if ((MMIO32(GPIO_BASE + 0x3c) & 1) == 0) {
        finish(18);
    }

    /* High-level status is routed by INT_ENA bit 0 and reasserts while high. */
    MMIO32(GPIO_PIN_CONFIG(0)) = (1U << 13) | (5U << 7);
    if ((MMIO32(GPIO_BASE + 0x44) & 1) == 0 ||
        (MMIO32(GPIO_BASE + 0x5c) & 1) == 0) {
        finish(19);
    }
    MMIO32(GPIO_BASE + 0x4c) = 1;
    if ((MMIO32(GPIO_BASE + 0x44) & 1) == 0) {
        finish(20);
    }
    MMIO32(GPIO_BASE + 0x0c) = 1;
    MMIO32(GPIO_BASE + 0x4c) = 1;
    if (MMIO32(GPIO_BASE + 0x44) & 1) {
        finish(21);
    }

    /* Rising-edge status latches and clears independently. */
    MMIO32(GPIO_OUTPUT_SELECT(1)) = 0x500;
    MMIO32(GPIO_BASE + 0x24) = 1U << 1;
    MMIO32(GPIO_PIN_CONFIG(1)) = (1U << 13) | (1U << 7);
    MMIO32(GPIO_BASE + 0x08) = 1U << 1;
    if ((MMIO32(GPIO_BASE + 0x44) & (1U << 1)) == 0 ||
        (MMIO32(GPIO_BASE + 0x5c) & (1U << 1)) == 0) {
        finish(22);
    }
    MMIO32(GPIO_BASE + 0x4c) = 1U << 1;
    if (MMIO32(GPIO_BASE + 0x44) & (1U << 1)) {
        finish(23);
    }

    /* Cache/MMU reset state comes from the ESP32-S2 register contract. */
    if (MMIO32(EXTMEM_BASE + 0x000) != 0x100 ||
        MMIO32(EXTMEM_BASE + 0x004) != 0x7 ||
        MMIO32(EXTMEM_BASE + 0x040) != 0x100 ||
        MMIO32(EXTMEM_BASE + 0x044) != 0x7 ||
        MMIO32(EXTMEM_BASE + 0x3fc) != 0x01904180 ||
        MMIO32(MMU_ENTRY(0)) != 0x4000 ||
        MMIO32(MMU_ENTRY(383)) != 0x4000) {
        finish(24);
    }

    /* IBus2/DROM page 0 maps through table entry 128. */
    MMIO32(EXTMEM_BASE + 0x044) = 0;
    MMIO32(EXTMEM_BASE + 0x040) = 1;
    MMIO32(MMU_ENTRY(128)) = 0x8001;
    if (MMIO32(0x3f000010) != 0x6a12b34c) {
        finish(25);
    }

    /* IBus0 starts at entry 0, but the usable IROM window begins at entry 8. */
    MMIO32(MMU_ENTRY(8)) = 0x8002;
    if (MMIO32(0x40080020) != 0xc501d2e3) {
        finish(26);
    }

    /* DBus0/DRAM0 starts at table entry 192. */
    MMIO32(EXTMEM_BASE + 0x004) = 0;
    MMIO32(EXTMEM_BASE + 0x000) = 1;
    MMIO32(MMU_ENTRY(192)) = 0x8003;
    if (MMIO32(0x3fc00030) != 0x7b24a9e1) {
        finish(27);
    }

    /* Cache maintenance completes synchronously but preserves cache enable. */
    MMIO32(EXTMEM_BASE + 0x040) = 0x101;
    if (MMIO32(EXTMEM_BASE + 0x040) != 0x201) {
        finish(28);
    }
    MMIO32(MMU_ENTRY(128)) = 0x4000;
    if (MMIO32(MMU_ENTRY(128)) != 0x4000) {
        finish(29);
    }

    finish(0);
}
