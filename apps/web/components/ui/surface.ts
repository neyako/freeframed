// Shared class strings for floating surfaces (dialogs, menus, popovers) so
// every overlay reads and moves the same. Motion keys off Radix data-state:
// quick pop in from the trigger, faster fade out (see tailwind.config.ts).

export const dialogOverlayClass =
  'fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-ff-fade-in data-[state=closed]:animate-ff-fade-out'

/** Add a max-w-* per dialog. */
export const dialogContentClass =
  'fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 rounded-md border border-border-strong bg-bg-secondary p-4 shadow-xl focus:outline-none data-[state=open]:animate-ff-rise-in data-[state=closed]:animate-ff-rise-out'

export const dialogTitleClass = 'text-[14px] font-medium text-text-primary'

export const dialogCloseClass =
  'absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary [&_svg]:h-[15px] [&_svg]:w-[15px]'

/** Radix menus/popovers/selects: add to any Content that sets data-state */
export const popMotionClass =
  'data-[state=open]:animate-ff-pop-in data-[state=closed]:animate-ff-pop-out'

export const menuContentClass =
  `z-50 min-w-[180px] rounded-md border border-border-strong bg-bg-elevated p-1 shadow-xl ${popMotionClass}`

export const menuItemClass =
  'flex h-8 w-full cursor-pointer select-none items-center gap-2 rounded px-2 text-[13px] text-text-secondary outline-none transition-colors duration-100 hover:bg-bg-hover hover:text-text-primary data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&_svg]:h-[15px] [&_svg]:w-[15px] [&_svg]:shrink-0'

export const menuItemDangerClass =
  `${menuItemClass} !text-accent`

export const menuSeparatorClass = 'my-1 h-px bg-border'
