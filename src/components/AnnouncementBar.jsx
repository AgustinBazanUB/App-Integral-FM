import { announcementMessages } from "../data/brand";

export default function AnnouncementBar() {
  return (
    <div className="announcement-bar" aria-label="Información de la tienda">
      <p className="announcement-bar__messages">
        {announcementMessages.map((message, index) => (
          <span className="announcement-bar__item" key={message}>
            {index > 0 ? (
              <span
                className="announcement-bar__separator"
                aria-hidden="true"
              >
                |
              </span>
            ) : null}
            <span className="announcement-bar__message">{message}</span>
          </span>
        ))}
      </p>
    </div>
  );
}
