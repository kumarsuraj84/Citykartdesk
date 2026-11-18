/**
 * The ticket pages (agent/requester page and the OEM engineer page) show text that people typed or pasted: a long web address, a serial number,
 * a table pasted from Excel, a file name. Such a word cannot be broken at a space, so it pushed the page wider than the window (up to 596 px on laptops,
 * measured with real users) and the part past the edge was cut off.
 *
 * `overflow-wrap: anywhere` lets a word that does not fit break at the edge of its box. Unlike `break-word` it also lowers the width a box asks for,
 * so boxes inside rows (flex) and columns (grid) shrink to the window instead of growing past it. The property is inherited, so it is set once on the page's
 * outer box and covers everything inside. (The class is written out in full here so Tailwind finds it.)
 */
export const TICKET_TEXT_WRAP = '[overflow-wrap:anywhere]'
