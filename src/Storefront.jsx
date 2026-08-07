import { useEffect } from "react";
import { Route, Routes, useLocation } from "./router";
import AnnouncementBar from "./components/AnnouncementBar";
import CartDrawer from "./components/CartDrawer";
import Footer from "./components/Footer";
import Header from "./components/Header";
import StorePreviewGate from "./gestion/StorePreviewGate";
import AboutPage from "./pages/AboutPage";
import CatalogPage from "./pages/CatalogPage";
import CheckoutPage from "./pages/CheckoutPage";
import HomePage from "./pages/HomePage";
import NotFoundPage from "./pages/NotFoundPage";
import ProductPage from "./pages/ProductPage";

function ScrollManager() {
  const location = useLocation();
  useEffect(() => {
    if (location.hash) {
      window.requestAnimationFrame(() => {
        document.querySelector(location.hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return;
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname, location.search, location.hash]);
  return null;
}

export default function Storefront() {
  return (
    <StorePreviewGate>
      <ScrollManager />
      <AnnouncementBar />
      <Header />
      <Routes>
        <Route path="/tienda" element={<HomePage />} />
        <Route path="/productos" element={<CatalogPage />} />
        <Route path="/producto/:slug" element={<ProductPage />} />
        <Route path="/nosotros" element={<AboutPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <Footer />
      <CartDrawer />
    </StorePreviewGate>
  );
}
