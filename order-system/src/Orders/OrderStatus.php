<?php
declare(strict_types=1);

namespace Buschmann\OrderSystem\Orders;

/**
 * Lebenszyklus einer Bestellung.
 *
 *   new ──▶ confirmed ──▶ in_production ──▶ completed
 *    │           │              │
 *    └───────────┴──────────────┴────────▶ cancelled
 *
 * Bewusst KEINE ausgebaute State Machine: keine Guards, keine Ereignisse,
 * kein Framework. Nur eine Zuordnungstabelle. Sie existiert trotzdem, weil
 * „abgeschlossen zurück auf neu" oder „storniert wieder in Produktion"
 * echte Datenkorruption wären — und die Absicherung acht Zeilen kostet.
 */
enum OrderStatus: string
{
    case New          = 'new';
    case Confirmed    = 'confirmed';
    case InProduction = 'in_production';
    case Completed    = 'completed';
    case Cancelled    = 'cancelled';

    public function canTransitionTo(self $target): bool
    {
        return in_array($target, $this->allowedTargets(), true);
    }

    public function isFinal(): bool
    {
        return $this->allowedTargets() === [];
    }

    public function label(): string
    {
        return match ($this) {
            self::New          => 'Neu',
            self::Confirmed    => 'Bestätigt',
            self::InProduction => 'In Produktion',
            self::Completed    => 'Abgeschlossen',
            self::Cancelled    => 'Storniert',
        };
    }

    /** @return self[] */
    private function allowedTargets(): array
    {
        return match ($this) {
            self::New          => [self::Confirmed, self::Cancelled],
            self::Confirmed    => [self::InProduction, self::Cancelled],
            self::InProduction => [self::Completed, self::Cancelled],
            self::Completed, self::Cancelled => [],
        };
    }
}
