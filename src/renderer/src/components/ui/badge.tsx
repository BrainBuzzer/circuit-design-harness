import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "group/badge inline-flex h-5.5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap transition-colors duration-150 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/90",
        secondary: "bg-field text-ink-2 shadow-btn [a]:hover:bg-hover",
        destructive: "bg-red-tint text-red focus-visible:ring-destructive/20 [a]:hover:bg-red-tint",
        outline:
          "border-line-strong bg-surface text-ink-2 shadow-btn [a]:hover:bg-hover [a]:hover:text-ink",
        ghost: "hover:bg-hover hover:text-ink dark:hover:bg-hover",
        link: "text-accent-ink underline-offset-4 hover:underline",
        success: "bg-green-tint text-green",
        warning: "bg-orange-tint text-orange",
        info: "bg-accent-tint text-accent-ink",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
