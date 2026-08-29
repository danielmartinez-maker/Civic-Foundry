#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Severity {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiagnosticRecord {
    pub sequence: u64,
    pub severity: Severity,
    pub subsystem: String,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DiagnosticError {
    SequenceOverflow,
}

#[derive(Default)]
pub struct DiagnosticBuffer {
    next_sequence: u64,
    records: Vec<DiagnosticRecord>,
}

impl DiagnosticBuffer {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(
        &mut self,
        severity: Severity,
        subsystem: impl Into<String>,
        message: impl Into<String>,
    ) -> Result<u64, DiagnosticError> {
        let sequence = self.next_sequence;
        self.next_sequence = self
            .next_sequence
            .checked_add(1)
            .ok_or(DiagnosticError::SequenceOverflow)?;
        self.records.push(DiagnosticRecord {
            sequence,
            severity,
            subsystem: subsystem.into(),
            message: message.into(),
        });
        Ok(sequence)
    }

    #[must_use]
    pub fn snapshot(&self) -> &[DiagnosticRecord] {
        &self.records
    }
}
