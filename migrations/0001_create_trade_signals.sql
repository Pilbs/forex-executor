CREATE TABLE trade_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    idempotency_key TEXT NOT NULL UNIQUE,

    signal_id TEXT NOT NULL,
    strategy_name TEXT NOT NULL,

    instrument TEXT NOT NULL,

    direction TEXT NOT NULL
        CHECK (direction IN ('buy', 'sell')),

    requested_units INTEGER NOT NULL
        CHECK (requested_units > 0),

    requested_stop_loss TEXT,
    requested_take_profit TEXT,

    webhook_payload TEXT NOT NULL,

    execution_status TEXT NOT NULL DEFAULT 'received'
        CHECK (
            execution_status IN (
                'received',
                'processing',
                'executed',
                'rejected',
                'failed'
            )
        ),

    oanda_order_id TEXT,
    oanda_trade_id TEXT,

    oanda_error_code TEXT,
    oanda_error_message TEXT,

    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    executed_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(strategy_name, signal_id)
);

CREATE INDEX idx_trade_signals_oanda_trade_id
    ON trade_signals(oanda_trade_id);

CREATE INDEX idx_trade_signals_status
    ON trade_signals(execution_status);