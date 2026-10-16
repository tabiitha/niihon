import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';

interface Location {
  readonly pathname: string;
  readonly search: string;
}

interface RouterValue {
  readonly location: Location;
  navigate(to: string): void;
}

const RouterContext = createContext<RouterValue | undefined>(undefined);

function currentLocation(): Location {
  return { pathname: window.location.pathname, search: window.location.search };
}

/** Keeps the displayed page in step with the address bar, using the History API. */
export function RouterProvider({ children }: { readonly children: ReactNode }) {
  const [location, setLocation] = useState(currentLocation);

  useEffect(() => {
    const update = () => setLocation(currentLocation());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);

  const navigate = useCallback((to: string) => {
    const target = new URL(to, window.location.href);
    if (target.pathname + target.search !== window.location.pathname + window.location.search) {
      window.history.pushState(null, '', target.pathname + target.search + target.hash);
      window.scrollTo(0, 0);
    }
    setLocation(currentLocation());
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext value={value}>{children}</RouterContext>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (value === undefined) {
    throw new Error('useRouter must be used inside RouterProvider.');
  }
  return value;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { readonly to: string };

/**
 * An ordinary link that changes page without reloading. Modified clicks (new tab, new window, download)
 * keep the browser's behavior, and the address stays a real URL that can be reloaded or shared.
 */
export function Link({ to, onClick, ...props }: LinkProps) {
  const { navigate } = useRouter();
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (props.target !== undefined && props.target !== '_self')
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handleClick} {...props} />;
}
