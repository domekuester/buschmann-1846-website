/**
 * Der Einstieg. Zwei Zeilen, und das ist der ganze Zweck der Datei:
 *
 * Weil <script type="module"> aufgeschoben ausgeführt wird, steht das DOM
 * hier bereits — es braucht kein DOMContentLoaded.
 *
 * Die Logik liegt getrennt in order-form.js, damit die UI-Tests sie einzeln
 * aufrufen können, ohne dass beim Import bereits etwas losläuft.
 */
import { initOrderForm } from './order-form.js';

initOrderForm(document);
