import { Clock3, Instagram, Mail, MapPin, Phone } from "lucide-react";
import { Link } from "../router";
import { brand, footerNavigation } from "../data/brand";

export default function Footer() {
  const { contact } = brand;
  const hasContactInformation = Boolean(
    contact.address ||
      contact.openingHours ||
      contact.phone ||
      contact.email,
  );

  return (
    <footer className="site-footer" id="contacto">
      <div className="container site-footer__top">
        <div className="footer-intro">
          <Link
            className="wordmark footer-logo"
            to="/"
            aria-label="Flor Mía - Inicio"
          >
            <img
              className="footer-logo__image"
              src={brand.logo.src}
              width={brand.logo.width}
              height={brand.logo.height}
              alt=""
              loading="lazy"
            />
          </Link>
          <p>{brand.tagline}</p>
          <a
            href={brand.instagram}
            target="_blank"
            rel="noreferrer"
            className="footer-social"
            aria-label="Flor Mía en Instagram, abre en una nueva pestaña"
          >
            <Instagram size={19} aria-hidden="true" />
            <span>Instagram</span>
          </a>
        </div>

        <div className="footer-columns">
          {footerNavigation.map((column) => (
            <nav aria-label={column.title} key={column.title}>
              <h2>{column.title}</h2>
              {column.links.map((link) => (
                <Link to={link.to} key={link.label}>
                  {link.label}
                </Link>
              ))}
            </nav>
          ))}
          <section
            className="footer-local"
            aria-labelledby="footer-local-title"
          >
            <h2 id="footer-local-title">Retirá en nuestro local</h2>

            {contact.address ? (
              <div className="footer-contact-item">
                <MapPin size={16} aria-hidden="true" />
                {contact.mapUrl ? (
                  <a href={contact.mapUrl} target="_blank" rel="noreferrer">
                    {contact.address}
                  </a>
                ) : (
                  <span>{contact.address}</span>
                )}
              </div>
            ) : null}

            {contact.openingHours ? (
              <div className="footer-contact-item">
                <Clock3 size={16} aria-hidden="true" />
                <span>{contact.openingHours}</span>
              </div>
            ) : null}

            {contact.phone ? (
              <div className="footer-contact-item">
                <Phone size={16} aria-hidden="true" />
                {contact.phoneUrl ? (
                  <a href={contact.phoneUrl}>{contact.phone}</a>
                ) : (
                  <span>{contact.phone}</span>
                )}
              </div>
            ) : null}

            {contact.email ? (
              <div className="footer-contact-item">
                <Mail size={16} aria-hidden="true" />
                <a href={contact.emailUrl ?? `mailto:${contact.email}`}>
                  {contact.email}
                </a>
              </div>
            ) : null}

            {!hasContactInformation ? (
              <p className="footer-pending">{contact.pendingMessage}</p>
            ) : null}
          </section>
        </div>
      </div>

      <div className="container footer-legal">
        <span>© {new Date().getFullYear()} Flor Mía</span>
        <span>Productos regionales de Mendoza</span>
        <Link to="/gestion">Acceso de gestión</Link>
      </div>
    </footer>
  );
}
