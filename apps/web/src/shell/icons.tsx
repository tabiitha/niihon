import type { ReactNode, SVGProps } from 'react';

/** Decorative line icons drawn inline, so the interface loads no remote icon font or image. */
function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { readonly children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = () => (
  <Icon>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
  </Icon>
);

export const LearnIcon = () => (
  <Icon>
    <path d="M12 6.5C10 5 7 4.5 3 5v14c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5Z" />
    <path d="M12 6.5V20" />
  </Icon>
);

export const KanjiIcon = () => (
  <Icon>
    <path d="M12 3v3M5 6h14v3M8 11h8l-4 3M12 14v7l-2-1M4 17h16" />
  </Icon>
);

export const LibraryIcon = () => (
  <Icon>
    <path d="M4 4h4v16H4zM10 4h4v16h-4z" />
    <path d="m16 5 3.5-1 2.5 15.5-3.5 1z" />
  </Icon>
);

export const ProfileIcon = () => (
  <Icon>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </Icon>
);

export const AdminIcon = () => (
  <Icon>
    <path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6Z" />
    <path d="m9 12 2 2 4-4" />
  </Icon>
);

export const ArrowIcon = () => (
  <Icon>
    <path d="M4 12h16M14 6l6 6-6 6" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M12 4v16M4 12h16" />
  </Icon>
);

export const SakuraLogo = () => (
  <svg viewBox="0 0 32 32" width="36" height="36" aria-hidden="true" focusable="false" className="logo">
    {[0, 72, 144, 216, 288].map((angle) => (
      <path
        key={angle}
        transform={`rotate(${angle} 16 16)`}
        d="M16 15c-3.2-2.4-5-5.2-4.2-8 .5-1.8 2-3 3.2-2.4L16 6l1-1.4c1.2-.6 2.7.6 3.2 2.4.8 2.8-1 5.6-4.2 8Z"
        fill="currentColor"
      />
    ))}
    <circle cx="16" cy="16" r="2.2" fill="var(--color-on-accent)" />
  </svg>
);

export const EyeIcon = () => (
  <Icon>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const EyeOffIcon = () => (
  <Icon>
    <path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.4 6.4C3.7 8.2 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.5 4.6-1.2" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </Icon>
);
