import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const RouterContext = createContext(null);
const ParamsContext = createContext({});

function readLocation() {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
}

export function RouterProvider({ children }) {
  const [location, setLocation] = useState(readLocation);

  useEffect(() => {
    const onLocationChange = () => setLocation(readLocation());
    window.addEventListener("popstate", onLocationChange);
    window.addEventListener("flor-mia:navigate", onLocationChange);
    return () => {
      window.removeEventListener("popstate", onLocationChange);
      window.removeEventListener("flor-mia:navigate", onLocationChange);
    };
  }, []);

  const navigate = useCallback((to, options = {}) => {
    const target = new URL(to, window.location.href);
    const next = `${target.pathname}${target.search}${target.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === current) return;

    if (options.replace) window.history.replaceState({}, "", next);
    else window.history.pushState({}, "", next);
    window.dispatchEvent(new Event("flor-mia:navigate"));
  }, []);

  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useLocation() {
  const context = useContext(RouterContext);
  if (!context) throw new Error("useLocation requiere RouterProvider");
  return context.location;
}

export function useNavigate() {
  const context = useContext(RouterContext);
  if (!context) throw new Error("useNavigate requiere RouterProvider");
  return context.navigate;
}

export function Link({ to, onClick, target, children, ...props }) {
  const navigate = useNavigate();

  const handleClick = (event) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      target === "_blank"
    ) {
      return;
    }

    const destination = new URL(to, window.location.href);
    if (destination.origin !== window.location.origin) return;
    event.preventDefault();
    navigate(`${destination.pathname}${destination.search}${destination.hash}`);
  };

  return (
    <a href={to} target={target} onClick={handleClick} {...props}>
      {children}
    </a>
  );
}

export function Route() {
  return null;
}

function matchRoute(pathPattern, pathname) {
  if (pathPattern === "*") return { matched: true, params: {} };

  const patternParts = pathPattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) {
    return { matched: false, params: {} };
  }

  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    const pathPart = pathParts[index];
    if (patternPart.startsWith(":")) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
    } else if (patternPart !== pathPart) {
      return { matched: false, params: {} };
    }
  }

  return { matched: true, params };
}

export function Routes({ children }) {
  const { pathname } = useLocation();
  const routes = Children.toArray(children).filter(isValidElement);
  let fallback = null;

  for (const route of routes) {
    if (route.props.path === "*") {
      fallback = route;
      continue;
    }

    const match = matchRoute(route.props.path, pathname);
    if (match.matched) {
      return (
        <ParamsContext.Provider value={match.params}>
          {cloneElement(route.props.element)}
        </ParamsContext.Provider>
      );
    }
  }

  return fallback ? cloneElement(fallback.props.element) : null;
}

export function useParams() {
  return useContext(ParamsContext);
}

export function useSearchParams() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );

  const setSearchParams = useCallback(
    (nextInit, options = {}) => {
      const next =
        nextInit instanceof URLSearchParams
          ? nextInit
          : new URLSearchParams(nextInit);
      const query = next.toString();
      navigate(
        `${location.pathname}${query ? `?${query}` : ""}${location.hash}`,
        options,
      );
    },
    [location.pathname, location.hash, navigate],
  );

  return [searchParams, setSearchParams];
}
