-- Der Zahlungsstatus einer Bestellung.
--
-- ER IST NICHT DER PRODUKTIONSSTATUS, und das ist die ganze Entscheidung
-- dieser Migration. `status` sagt, wie weit die Backstube ist; `payment_status`
-- sagt, ob das Geld da ist. Beides in eine Spalte zu falten wäre der Griff,
-- der sich später nicht mehr auflösen lässt: „abgeschlossen und trotzdem
-- offen" ist im Betrieb der NORMALFALL — der Kuchen ist abgeholt, die
-- Rechnung wird am Monatsende beglichen. Ein Zustandsautomat, der beides
-- zugleich führte, müsste diesen Fall entweder verbieten oder verdoppeln.
--
-- KEIN KASSENSYSTEM. Es gibt hier keinen Betrag, keine Teilzahlung, keine
-- Rückerstattung, keine Rechnungsnummer und keine Zahlungshistorie. Der
-- BETRAG einer Bestellung steht seit 0003 in total_amount_cents und wird beim
-- Anlegen einmal geschrieben; ein zweiter Geldbetrag in dieser Zeile wäre ein
-- zweiter Wahrheitsanspruch und damit die Vorlage für eine Differenz, die
-- niemand auflösen kann.
--
-- WAS DIESE MIGRATION AM UMSATZ ÄNDERT: nichts. Umsatz ist, was bestellt und
-- nicht storniert wurde. Ob er bereits geflossen ist, ist eine andere Frage
-- und wird hier getrennt beantwortet.
--
-- KEIN BACKFILL, KEIN RATEN. Jede bestehende Bestellung steht nach dieser
-- Migration auf 'unpaid'. Das ist keine Behauptung über die Vergangenheit,
-- sondern die einzige ehrliche Ausgangslage: Es gibt in diesem System keine
-- Quelle dafür, welche Bestellung vor heute bezahlt wurde — dieselbe Regel
-- wie bei customers.price_list_id in 0013 und products.catalog_product_id in
-- 0014.
--
-- KEIN NEUER INDEX. Die Tagesansicht fragt über fulfillment_date, und
-- idx_orders_day aus 0003 beginnt mit genau dieser Spalte. Ein Index auf
-- payment_status hätte fünf Werte und keine Selektivität; er kostete
-- Schreibarbeit bei jeder Bestellung und spart nichts.
ALTER TABLE orders
    ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CONSTRAINT chk_orders_payment_status CHECK (
        payment_status IN ('unpaid', 'paid_cash', 'paid_card', 'paid_bank', 'paid_other')
    );

-- Wann der Zahlungsstand zuletzt eingetragen wurde — ISO-8601-UTC wie
-- created_at und updated_at, oder NULL.
--
-- DIE KOPPLUNG AN payment_status IST BEWUSST IM SCHEMA UND NICHT NUR IM CODE.
--
-- „bezahlt, aber ohne Zeitpunkt" und „unbezahlt, aber mit Zeitpunkt" sind
-- beides Zeilen, aus denen später niemand mehr herauslesen kann, was gemeint
-- war — und beide entstehen nicht durch böse Absicht, sondern durch ein
-- vergessenes Feld in einem UPDATE. Eine Regel, die nur im Anwendungscode
-- steht, gilt für den Anwendungscode; eine im CHECK gilt auch für die Konsole,
-- das Wartungsskript und den Import.
--
-- Er ist ausdrücklich KEINE Historie: Wechselt der Stand von 'paid_cash' auf
-- 'paid_card', wird der Zeitpunkt überschrieben und nicht ergänzt. Diese
-- Spalte beantwortet „wann wurde der aktuelle Stand eingetragen?" und nicht
-- „was war vorher?". Für die zweite Frage bräuchte es eine eigene Tabelle,
-- und die gehört nicht in diese Phase.
ALTER TABLE orders
    ADD COLUMN payment_recorded_at TEXT
    CONSTRAINT chk_orders_payment_recorded_at CHECK (
        (payment_status = 'unpaid' AND payment_recorded_at IS NULL)
        OR (payment_status <> 'unpaid' AND payment_recorded_at IS NOT NULL)
    );
