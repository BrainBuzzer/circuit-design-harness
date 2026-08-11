ENTRY(_start)

SECTIONS
{
    . = 0x40021000;
    .text : ALIGN(4)
    {
        *(.literal .literal.*)
        *(.text .text.*)
    }

    .rom.rodata 0x3ffac600 : AT(0x4001c600)
    {
        KEEP(*(.rom.rodata))
    }
}
