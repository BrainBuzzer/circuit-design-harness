ENTRY(_start)

SECTIONS
{
    . = 0x50000000;
    .reset : ALIGN(4)
    {
        KEEP(*(.reset))
    }

    . = 0x50000100;
    .text : ALIGN(4)
    {
        KEEP(*(.text.start))
        *(.text .text.*)
    }
}
