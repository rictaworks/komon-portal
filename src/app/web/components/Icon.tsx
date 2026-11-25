import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

/** Decorative Font Awesome icon. Meaning is always carried by the text next to it. */
export function Icon({ icon }: { icon: IconDefinition }) {
  return <FontAwesomeIcon icon={icon} aria-hidden="true" fixedWidth />;
}
