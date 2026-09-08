ALTER TABLE trade_signals
ADD COLUMN bot_close_transaction_id TEXT;

CREATE INDEX idx_trade_signals_bot_close_transaction_id
    ON trade_signals(bot_close_transaction_id);
