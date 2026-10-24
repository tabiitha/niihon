import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { apiClient } from '../../api/client.ts';
import { RequestCancelledError } from '../../api/outcome.ts';
import { useResource } from '../../api/resource.ts';
import { useTexts } from '../../i18n/I18n.tsx';
import { Link, useRouter } from '../../router/Router.tsx';
import { routes } from '../../router/routes.ts';
import { ArrowIcon, EyeIcon, EyeOffIcon } from '../../shell/icons.tsx';
import { Page } from '../../shell/Page.tsx';
import { describeFailure, mayHaveCreatedProfile, type FormField, type Problem } from './errors.ts';
import {
  createPendingStore,
  finishProviderRegistration,
  loadProviders,
  newIdempotencyKey,
  parseProviderReturn,
  registerLocal,
  startProviderRegistration,
  type Profile,
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

function useProblemText() {
  const t = useTexts(accountsTexts);
  return (problem: Problem) => t(problem.message);
}

function RequestReference({ problem }: { readonly problem: Problem }) {
  const t = useTexts(accountsTexts);
  return problem.requestId === undefined ? null : <span className="status-detail">{t('errorReference', { requestId: problem.requestId })}</span>;
}

function RegistrationForm() {
  const t = useTexts(accountsTexts);
  const problemText = useProblemText();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [reveal, setReveal] = useState({ password: false, confirmation: false });
  const [busy, setBusy] = useState<'local' | { readonly provider: string } | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | undefined>(undefined);
  const [providers] = useResource('oauth-providers', (signal) => loadProviders(apiClient, signal));

  // A synchronous guard: a second submit can arrive before the busy state has been rendered.
  const sending = useRef(false);
  const pending = useRef<AbortController | undefined>(undefined);
  // The key of the command being retried; any edit makes the next attempt a new command.
  const idempotencyKey = useRef<string | undefined>(undefined);
  const inputs = {
    username: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    confirmation: useRef<HTMLInputElement>(null),
  } satisfies Record<FormField, unknown>;
  const notice = useRef<HTMLParagraphElement>(null);
  const ids = { username: useId(), password: useId(), confirmation: useId(), problem: useId(), providers: useId() };

  // Leaving the page cancels what is pending; the late answer is ignored.
  useEffect(() => () => pending.current?.abort(), []);

  useEffect(() => {
    if (problem?.field !== undefined) {
      inputs[problem.field].current?.focus();
    }
    // The refs are stable; focus follows each new problem.
  }, [problem]);

  useEffect(() => {
    if (profile !== undefined) {
      notice.current?.focus();
    }
  }, [profile]);

  const edit = (setter: (value: string) => void) => (value: string) => {
    idempotencyKey.current = undefined;
    setter(value);
  };

  const begin = () => {
    sending.current = true;
    setProblem(undefined);
    pending.current?.abort();
    pending.current = new AbortController();
    return pending.current;
  };

  const end = (controller: AbortController) => {
    if (!controller.signal.aborted) {
      sending.current = false;
      setBusy(undefined);
    }
  };

  const failWith = (value: Problem) => setProblem(value);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (sending.current) {
      return;
    }
    if (username.trim() === '') {
      return failWith({ message: 'usernameRequired', field: 'username' });
    }
    if (password === '') {
      return failWith({ message: 'passwordRequired', field: 'password' });
    }
    if (password !== confirmation) {
      return failWith({ message: 'passwordsDiffer', field: 'confirmation' });
    }
    const controller = begin();
    setBusy('local');
    const key = (idempotencyKey.current ??= newIdempotencyKey());
    try {
      const outcome = await registerLocal(apiClient, { username, password }, key, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      if (outcome.ok) {
        // Nothing of the secret stays in the page once the server has answered.
        setPassword('');
        setConfirmation('');
        idempotencyKey.current = undefined;
        setProfile(outcome.data);
        return;
      }
      failWith(describeFailure(outcome.failure));
      if (!mayHaveCreatedProfile(outcome.failure)) {
        // A definite refusal: the username stays, the secrets are typed again.
        idempotencyKey.current = undefined;
        setPassword('');
        setConfirmation('');
      }
    } catch (error) {
      if (!(error instanceof RequestCancelledError)) {
        failWith({ message: 'errorGeneric' });
      }
    } finally {
      end(controller);
    }
  }

  async function continueWith(provider: string) {
    if (sending.current) {
      return;
    }
    if (username.trim() === '') {
      return failWith({ message: 'usernameNeededForProvider', field: 'username' });
    }
    const controller = begin();
    setBusy({ provider });
    try {
      const result = await startProviderRegistration(
        apiClient,
        pendingStore(),
        { provider, username, origin: window.location.origin },
        controller.signal,
      );
      if (controller.signal.aborted) {
        return;
      }
      if (result.kind === 'redirect') {
        // The page is left for the provider; it stays busy until then.
        window.location.assign(result.address);
        return;
      }
      failWith(result.kind === 'storage' ? { message: 'errorStorage' } : describeFailure(result.failure));
    } catch (error) {
      if (!(error instanceof RequestCancelledError)) {
        failWith({ message: 'errorGeneric' });
      }
    }
    end(controller);
  }

  if (profile !== undefined) {
    return (
      <Page title={t('successTitle')} className="auth-card">
        <p ref={notice} tabIndex={-1} role="status">
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

  const describedBy = (field: FormField, hint?: string) =>
    [hint, problem?.field === field ? ids.problem : undefined].filter((id) => id !== undefined).join(' ') || undefined;
  const offered = providers.status === 'ready' ? providers.data : [];

  return (
    <Page title={t('title')} className="auth-card">
      <p className="muted">{t('subtitle')}</p>
      <form noValidate onSubmit={(event) => void submit(event)} aria-busy={busy === 'local'}>
        {problem !== undefined && (
          <p id={ids.problem} className="form-problem" role="alert">
            <span>{problemText(problem)}</span>
            <RequestReference problem={problem} />
          </p>
        )}
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
            aria-invalid={problem?.field === 'username' ? true : undefined}
            aria-describedby={describedBy('username', `${ids.username}-hint`)}
            onChange={(event) => edit(setUsername)(event.target.value)}
          />
          <span id={`${ids.username}-hint`} className="field-hint">
            {t('usernameHint')}
          </span>
        </div>
        {(
          [
            ['password', ids.password, password, setPassword, 'passwordLabel', 'showPassword', 'hidePassword', 'new-password'],
            ['confirmation', ids.confirmation, confirmation, setConfirmation, 'confirmationLabel', 'showConfirmation', 'hideConfirmation', 'new-password'],
          ] as const
        ).map(([field, id, value, setter, label, show, hide, autoComplete]) => (
          <div className="auth-field" key={field}>
            <label htmlFor={id}>{t(label)}</label>
            <div className="password-control">
              <input
                ref={inputs[field]}
                id={id}
                name={field}
                type={reveal[field] ? 'text' : 'password'}
                autoComplete={autoComplete}
                autoCapitalize="none"
                spellCheck={false}
                required
                value={value}
                aria-invalid={problem?.field === field ? true : undefined}
                aria-describedby={describedBy(field, field === 'password' ? `${id}-hint` : undefined)}
                onChange={(event) => edit(setter)(event.target.value)}
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
            {field === 'password' && (
              <span id={`${id}-hint`} className="field-hint">
                {t('passwordHint')}
              </span>
            )}
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
          <p className="muted">{t('providersNote')}</p>
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
                  onClick={() => void continueWith(provider)}
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
  const problemText = useProblemText();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<
    | { readonly kind: 'working' }
    | { readonly kind: 'registered'; readonly profile: Profile }
    | { readonly kind: 'problem'; readonly problem: Problem; readonly retryable: boolean }
  >({ kind: 'working' });
  const notice = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // The code and the state leave the address bar and the history at once.
    window.history.replaceState(null, '', routes.register);
    const controller = new AbortController();
    setResult({ kind: 'working' });
    finishProviderRegistration(apiClient, pendingStore(), answer, controller.signal).then(
      (finished) => {
        if (controller.signal.aborted) {
          return;
        }
        setResult(
          finished.kind === 'registered'
            ? { kind: 'registered', profile: finished.profile }
            : {
                kind: 'problem',
                problem:
                  finished.kind === 'denied'
                    ? { message: 'errorProviderDenied' }
                    : finished.kind === 'mismatch'
                      ? { message: 'errorFlowInvalid' }
                      : describeFailure(finished.failure),
                retryable: finished.kind === 'failed' && finished.retryable,
              },
        );
      },
      (error: unknown) => {
        if (!controller.signal.aborted && !(error instanceof RequestCancelledError)) {
          setResult({ kind: 'problem', problem: { message: 'errorGeneric' }, retryable: false });
        }
      },
    );
    return () => controller.abort();
    // `answer` never changes for a mounted page; a retry runs the same completion again.
  }, [attempt]);

  useEffect(() => {
    if (result.kind !== 'working') {
      notice.current?.focus();
    }
  }, [result.kind]);

  if (result.kind === 'registered') {
    return (
      <Page title={t('successTitle')} className="auth-card">
        <p ref={notice} tabIndex={-1} role="status">
          {t('successBody', { username: result.profile.username })}
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
  if (result.kind === 'problem') {
    return (
      <Page title={t('callbackFailedTitle')} className="auth-card">
        <p ref={notice} tabIndex={-1} className="form-problem" role="alert">
          <span>{problemText(result.problem)}</span>
          <RequestReference problem={result.problem} />
        </p>
        <div className="actions">
          {result.retryable && (
            <button type="button" className="button-primary" onClick={() => setAttempt((value) => value + 1)}>
              {t('tryAgain')}
            </button>
          )}
          <Link to={routes.register} className={result.retryable ? 'button-secondary' : 'button-primary'}>
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
