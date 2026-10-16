import { apiVersion } from '@nihon/api-client';

import type { Failure } from '../api/outcome.ts';
import { useTexts } from '../i18n/I18n.tsx';
import { shellTexts } from './texts.ts';

/** Shows why content is missing, with a retry action. `failure` is undefined while loading. */
export function StatusPanel({ failure, onRetry }: { readonly failure?: Failure | undefined; readonly onRetry: () => void }) {
  const t = useTexts(shellTexts);

  if (failure === undefined) {
    return (
      <div className="status" role="status">
        <span className="spinner" aria-hidden="true" />
        <p>{t('loading')}</p>
      </div>
    );
  }

  const [title, body] =
    failure.kind === 'unavailable'
      ? [t('unavailableTitle'), t('unavailableBody')]
      : failure.kind === 'incompatible'
        ? [t('incompatibleTitle'), t('incompatibleBody')]
        : [t('errorTitle'), t('errorBody')];

  return (
    <section className="status" role="alert" aria-labelledby="status-title" data-failure={failure.kind}>
      <h2 id="status-title">{title}</h2>
      <p>{body}</p>
      {failure.kind === 'incompatible' && failure.serverApiVersion !== undefined && (
        <p className="status-detail">
          {t('incompatibleVersions', { serverVersion: failure.serverApiVersion, clientVersion: apiVersion })}
        </p>
      )}
      {failure.kind === 'error' && failure.requestId !== undefined && (
        <p className="status-detail">{t('errorReference', { requestId: failure.requestId })}</p>
      )}
      <button type="button" className="button-primary" onClick={onRetry}>
        {t('retry')}
      </button>
    </section>
  );
}
