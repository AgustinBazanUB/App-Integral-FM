import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, Search, ShoppingCart, X } from "lucide-react";
import { Link, useLocation } from "../router";
import { brand, mobileNavigation, navigation } from "../data/brand";
import { useCart } from "../context/CartContext";
import SearchModal from "./SearchModal";

function isCurrentNavigationItem(to, location) {
  const target = new URL(to, window.location.origin);

  if (target.pathname !== location.pathname) return false;
  if (target.hash) return target.hash === location.hash;
  if (target.pathname === "/tienda" && location.hash) return false;
  if (target.search) return target.search === location.search;

  if (target.pathname === "/productos") {
    const currentSearch = new URLSearchParams(location.search);
    return (
      !currentSearch.has("categoria") && !currentSearch.has("coleccion")
    );
  }

  return true;
}

export default function Header() {
  const location = useLocation();
  const { unitCount, openCart } = useCart();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const menuButtonRef = useRef(null);
  const mobileNavigationRef = useRef(null);
  const searchTriggerRef = useRef(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 48);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    };
    const onPointerDown = (event) => {
      if (
        mobileNavigationRef.current?.contains(event.target) ||
        menuButtonRef.current?.contains(event.target)
      ) {
        return;
      }
      setMenuOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const openSearch = (event) => {
    searchTriggerRef.current = event.currentTarget;
    setMenuOpen(false);
    setSearchOpen(true);
  };
  const toggleMenu = () => {
    setSearchOpen(false);
    setMenuOpen((current) => !current);
  };
  const handleCartClick = () => {
    setMenuOpen(false);
    setSearchOpen(false);
    openCart();
  };

  return (
    <>
      <header
        className={`site-header site-header--solid ${scrolled ? "is-scrolled" : ""}`}
      >
        <div className="site-header__inner">
          <Link
            className="wordmark header-logo"
            to="/tienda"
            aria-label="Flor Mía - Inicio"
          >
            <img
              className="header-logo__image"
              src={brand.logo.src}
              width={brand.logo.width}
              height={brand.logo.height}
              alt=""
            />
          </Link>

          <nav className="desktop-nav" aria-label="Navegación principal">
            {navigation.map((item) => (
              <Link
                to={item.to}
                key={item.label}
                aria-current={
                  isCurrentNavigationItem(item.to, location)
                    ? "page"
                    : undefined
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="header-actions">
            <button
              type="button"
              className="header-search desktop-only"
              onClick={openSearch}
              aria-label="Buscar productos"
              aria-haspopup="dialog"
              aria-expanded={searchOpen}
            >
              <span>Buscar productos...</span>
              <Search aria-hidden="true" />
            </button>
            <button
              type="button"
              className="header-action mobile-menu-button mobile-search-button"
              onClick={openSearch}
              aria-label="Buscar productos"
              aria-haspopup="dialog"
              aria-expanded={searchOpen}
            >
              <Search aria-hidden="true" />
            </button>
            <button
              type="button"
              className="header-action cart-action"
              onClick={handleCartClick}
              aria-label={`Abrir carrito, ${unitCount} ${unitCount === 1 ? "producto" : "productos"}`}
            >
              <ShoppingCart aria-hidden="true" />
              <span className="cart-count" aria-hidden="true">
                {unitCount}
              </span>
            </button>
            <button
              ref={menuButtonRef}
              type="button"
              className="header-action mobile-menu-button"
              onClick={toggleMenu}
              aria-expanded={menuOpen}
              aria-controls="mobile-navigation"
              aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"}
            >
              {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </button>
          </div>
        </div>

        {menuOpen ? (
          <nav
            ref={mobileNavigationRef}
            className="mobile-nav"
            id="mobile-navigation"
            aria-label="Navegación móvil"
          >
            {mobileNavigation.map((item) => (
              <Link
                to={item.to}
                key={item.label}
                onClick={() => setMenuOpen(false)}
                aria-current={
                  isCurrentNavigationItem(item.to, location)
                    ? "page"
                    : undefined
                }
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}
      </header>
      <SearchModal
        open={searchOpen}
        onClose={closeSearch}
        returnFocusRef={searchTriggerRef}
      />
    </>
  );
}