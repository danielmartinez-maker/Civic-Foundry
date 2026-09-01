#[derive(Debug, Clone, PartialEq, Eq)]
pub enum P2AError {
    Decode {
        message: String,
    },
    UnsupportedSchema {
        found: u32,
    },
    UnsupportedSourceVersion {
        save_version: u32,
        game_version: String,
    },
    WorldValidation {
        code: &'static str,
        field: String,
    },
    CadastreValidation {
        code: &'static str,
        entity_id: Option<String>,
    },
    Geometry {
        code: &'static str,
        entity_id: Option<String>,
    },
    MutationRejected {
        reasons: Vec<String>,
    },
    ParityMismatch {
        section: String,
        detail: String,
    },
}
