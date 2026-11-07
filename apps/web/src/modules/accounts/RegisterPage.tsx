import { useEffect, useId, useRef, useState, useSyncExternalStore, type Ref } from 'react';

import { apiClient } from '../../api/client.ts';
import { RequestCancelledError } from '../../api/outcome.ts';
import { useResource } from '../../api/resource.ts';
import { useTexts } from '../../i18n/I18n.tsx';
import { Link, useRouter } from '../../router/Router.tsx';
import { routes } from '../../router/routes.ts';
import { ArrowIcon, EyeIcon, EyeOffIcon } from '../../shell/icons.tsx';
import { Page } from '../../shell/Page.tsx';
import type { FormField, Problem } from './errors.ts';
import { createRegistrationForm, deliveryOfFieldError, viewOfFinish, type ReturnView } from './form.ts';
import {
  createPendingStore,
  finishProviderRegistration,
  loadProviders,
  parseProviderReturn,
  type ProviderReturn,
} from './registration.ts';
import { accountsTexts } from './texts.ts';

/** Session storage is the only place the pending provider registration waits while the provider's page is open. */
function pendingStore() {
  try {
    return createPendingStore(window.sessionStorage);
  } catch {
    return createPendingStore(undefined);
  }
}

/**
 * The registration screen, and the address the provider returns to. The page is mounted anew for every
 * address, so leaving it cancels its pending requests and ignores their late answers.
 */
export function RegisterPage() {
  const { location } = useRouter();
  // The provider's answer is read once: the address is cleaned up as soon as it has been read.
  const [answer] = useState(() => parseProviderReturn(location.search));
  return answer === undefined ? <RegistrationForm /> : <ProviderReturn answer={answer} />;
}

/**
 * A problem that belongs to no field, above the form. Focus moves to it when it appears, which reads it once; it is
 * not a live region as well, so that it is not announced twice.
 */
function ProblemMessage({ problem, notice }: { readonly problem: Problem; readonly notice: Ref<HTMLParagraphElement> }) {
  const t = useTexts(accountsTexts);
  return (
    <p ref={notice} tabIndex={-1} className="form-problem">
      {t(problem.message)}
    </p>
  );
}

function RegistrationForm() {
  const t = useTexts(accountsTexts);
  const [form] = useState(() =>
    createRegistrationForm({
      client: apiClient,
      store: pendingStore(),
      origin: window.location.origin,
      openProvider: (address) => window.location.assign(address),
    }),
  );
  const { username, password, confirmation, busy, errors, problem, focus, profile } = useSyncExternalStore(form.subscribe, form.getState);
  const [providers] = useResource('oauth-providers', (signal) => loadProviders(apiClient, signal));
  const [reveal, setReveal] = useState({ password: false, confirmation: false });
  const inputs = {
    username: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirmation: useRef<HTMLInputElement>(null),
  } satisfies Record<FormField, unknown>;
  const notice = useRef<HTMLParagraphElement>(null);
  const ids = { username: useId(), password: useId(), confirmation: useId(), providers: useId() };

  // Leaving the page cancels what is pending; the late answer is ignored.
  useEffect(() => form.connect(), [form]);

  // A field error announced by the live region; empty otherwise.
  const [announcement, setAnnouncement] = useState('');
  // An announced error is not left in the page once the person types again.
  useEffect(() => setAnnouncement(''), [username, password, confirmation]);

  // A page restored from the back-forward cache keeps its busy state but lost its requests.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) {
        form.restored();
      }
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, [form]);

  // A field error moves focus to its field, whose error is then read with it. When the field already has focus
  // (Enter in that field), the error is announced once by the live region instead. A problem of no field: see below.
  useEffect(() => {
    if (focus === undefined) {
      return;
    }
    const input = inputs[focus.field].current;
    const error = errors[focus.field];
    // Emptied first, so that the same message repeated by a second Enter is announced again.
    setAnnouncement('');
    if (deliveryOfFieldError(input !== null && document.activeElement === input) === 'focus') {
      input?.focus();
      return;
    }
    const timer = window.setTimeout(() => setAnnouncement(error === undefined ? '' : t(error.message)), 100);
    return () => window.clearTimeout(timer);
    // The refs are stable; focus follows each request, with the errors of that request.
  }, [focus]);

  useEffect(() => {
    if (problem !== undefined) {
      notice.current?.focus();
    }
  }, [problem]);

  useEffect(() => {
    if (profile !== undefined) {
      notice.current?.focus();
    }
  }, [profile]);

  if (profile !== undefined) {
    return (
      <Page title={t('successTitle')} className="auth-card">
        <p ref={notice} tabIndex={-1}>
          {t('successBody', { username: profile.username })}
        </p>
        <div className="actions">
          <Link to={routes.home} className="button-primary">
            <span>{t('backHome')}</span>
            <ArrowIcon />
          </Link>
        </div>
      </Page>
    );
  }

  // One message under a faulty field, in the error color, linked to it: read when the field gets focus. It is not
  // a live region, so a screen reader announces it once, with the field (on submit, focus moves there).
  const errorId = (field: FormField) => `${ids[field]}-error`;
  const fieldError = (field: FormField) => {
    const error = errors[field];
    return error === undefined ? null : (
      <p id={errorId(field)} className="field-error">
        {t(error.message)}
      </p>
    );
  };
  const invalid = (field: FormField) =>
    errors[field] === undefined ? {} : { 'aria-invalid': true as const, 'aria-describedby': errorId(field) };
  const offered = providers.status === 'ready' ? providers.data : [];

  return (
    <Page title={t('title')} className="auth-card">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void form.submit();
        }}
        aria-busy={busy === 'local'}
      >
        <p className="visually-hidden" aria-live="polite">
          {announcement}
        </p>
        {problem !== undefined && <ProblemMessage problem={problem} notice={notice} />}
        <div className="auth-field">
          <label htmlFor={ids.username}>{t('usernameLabel')}</label>
          <input
            ref={inputs.username}
            id={ids.username}
            name="username"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            {...invalid('username')}
            onChange={(event) => form.setField('username', event.target.value)}
            onBlur={() => form.leaveField('username')}
          />
          {fieldError('username')}
        </div>
        {(
          [
            ['password', ids.password, password, 'passwordLabel', 'showPassword', 'hidePassword'],
            ['confirmation', ids.confirmation, confirmation, 'confirmationLabel', 'showConfirmation', 'hideConfirmation'],
          ] as const
        ).map(([field, id, value, label, show, hide]) => (
          <div className="auth-field" key={field}>
            <label htmlFor={id}>{t(label)}</label>
            <div className="password-control">
              <input
                ref={inputs[field]}
                id={id}
                name={field}
                type={reveal[field] ? 'text' : 'password'}
                autoComplete="new-password"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={value}
                {...invalid(field)}
                onChange={(event) => form.setField(field, event.target.value)}
                onBlur={() => form.leaveField(field)}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={reveal[field] ? t(hide) : t(show)}
                onClick={() => setReveal((current) => ({ ...current, [field]: !current[field] }))}
              >
                {reveal[field] ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            {fieldError(field)}
          </div>
        ))}
        <button type="submit" className="button-primary button-block" disabled={busy !== undefined}>
          <span>{busy === 'local' ? t('submitting') : t('submit')}</span>
          <ArrowIcon />
        </button>
      </form>
      {offered.length > 0 && (
        <section className="providers" aria-labelledby={ids.providers}>
          <h2 id={ids.providers}>{t('providersTitle')}</h2>
          <div className="provider-actions">
            {offered.map((provider) => {
              const name = provider === 'google' ? t('providerGoogle') : provider === 'github' ? t('providerGithub') : provider;
              const starting = typeof busy === 'object' && busy.provider === provider;
              return (
                <button
                  key={provider}
                  type="button"
                  className="button-provider"
                  disabled={busy !== undefined}
                  onClick={() => void form.continueWith(provider)}
                >
                  {starting ? t('startingProvider', { provider: name }) : t('continueWithProvider', { provider: name })}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </Page>
  );
}

/** The screen the provider returns to: completes the registration, or says why it could not be completed. */
function ProviderReturn({ answer }: { readonly answer: ProviderReturn }) {
  const t = useTexts(accountsTexts);
  const [attempt, setAttempt] = useState<{ readonly count: number; readonly withoutKey: boolean }>({ count: 0, withoutKey: false });
  const [view, setView] = useState<ReturnView | undefined>(undefined);
  const notice = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // The code and the state leave the address bar and the history at once.
    window.history.replaceState(null, '', routes.register);
    const controller = new AbortController();
    setView(undefined);
    finishProviderRegistration(apiClient, pendingStore(), answer, controller.signal, { withoutKey: attempt.withoutKey }).then(
      (finished) => {
        if (!controller.signal.aborted) {
          setView(viewOfFinish(finished));
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted && !(error instanceof RequestCancelledError)) {
          setView({ kind: 'problem', problem: { message: 'errorGeneric' }, retry: undefined });
        }
      },
    );
    return () => controller.abort();
    // `answer` never changes for a mounted page; a retry runs the same completion again.
  }, [attempt]);

  useEffect(() => {
    if (view !== undefined) {
      notice.current?.focus();
    }
  }, [view]);

  if (view?.kind === 'registered') {
    return (
      <Page title={t('successTitle')} className="auth-card">
        <p ref={notice} tabIndex={-1}>
          {t('successBody', { username: view.profile.username })}
        </p>
        <div className="actions">
          <Link to={routes.home} className="button-primary">
            <span>{t('backHome')}</span>
            <ArrowIcon />
          </Link>
        </div>
      </Page>
    );
  }
  if (view?.kind === 'problem') {
    const { retry } = view;
    return (
      <Page title={t('callbackFailedTitle')} className="auth-card">
        <ProblemMessage problem={view.problem} notice={notice} />
        <div className="actions">
          {retry !== undefined && (
            <button
              type="button"
              className="button-primary"
              onClick={() => setAttempt((current) => ({ count: current.count + 1, withoutKey: retry === 'withoutKey' }))}
            >
              {t('tryAgain')}
            </button>
          )}
          <Link to={routes.register} className={retry === undefined ? 'button-primary' : 'button-secondary'}>
            {t('startAgain')}
          </Link>
        </div>
      </Page>
    );
  }
  return (
    <Page title={t('callbackTitle')} className="auth-card">
      <div className="status" role="status">
        <span className="spinner" aria-hidden="true" />
        <p>{t('callbackProgress')}</p>
      </div>
    </Page>
  );
}
