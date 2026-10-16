import { useEffect, type ReactNode } from 'react';

import { useTexts } from '../i18n/I18n.tsx';
import { shellTexts } from './texts.ts';

/** Common page frame: the document title and the page heading, which `titleHidden` keeps for assistive technology only. */
export function Page({
  title,
  titleHidden = false,
  children,
}: {
  readonly title: string;
  readonly titleHidden?: boolean;
  readonly children?: ReactNode;
}) {
  const t = useTexts(shellTexts);
  useEffect(() => {
    document.title = t('documentTitle', { page: title });
  }, [t, title]);

  return (
    <article className="page" aria-labelledby="page-title">
      <h1 id="page-title" className={titleHidden ? 'visually-hidden' : undefined}>
        {title}
      </h1>
      {children}
    </article>
  );
}
