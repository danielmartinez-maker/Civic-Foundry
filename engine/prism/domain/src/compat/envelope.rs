use serde::Deserialize;

use crate::cadastre::graph::CadastralGraph;
use crate::cadastre::types::CadastralSnapshot;
use crate::error::P2AError;
use crate::world::import::WorldMirror;
use crate::world::types::WorldFoundationSnapshot;

pub const P2A_IMPORT_SCHEMA_VERSION: u32 = 1;
pub const P2A_SOURCE_SAVE_VERSION: u32 = 9;
pub const P2A_SOURCE_GAME_VERSION: &str = "0.9.0-urban-fabric";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvelopeHeader {
    schema_version: u32,
    source_save_version: u32,
    source_game_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnvelopeWire {
    schema_version: u32,
    source_save_version: u32,
    source_game_version: String,
    world: WorldFoundationSnapshot,
    cadastre: CadastralSnapshot,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DecodedP2AEnvelope {
    pub world: WorldFoundationSnapshot,
    pub cadastre: CadastralSnapshot,
}

#[derive(Clone, Debug, PartialEq)]
pub struct P2AMirror {
    pub world: WorldMirror,
    pub cadastre: CadastralGraph,
}

pub fn decode_envelope_json(bytes: &[u8]) -> Result<DecodedP2AEnvelope, P2AError> {
    let header: EnvelopeHeader = serde_json::from_slice(bytes).map_err(decode_error)?;

    if header.schema_version != P2A_IMPORT_SCHEMA_VERSION {
        return Err(P2AError::UnsupportedSchema {
            found: header.schema_version,
        });
    }

    if header.source_save_version != P2A_SOURCE_SAVE_VERSION
        || header.source_game_version != P2A_SOURCE_GAME_VERSION
    {
        return Err(P2AError::UnsupportedSourceVersion {
            save_version: header.source_save_version,
            game_version: header.source_game_version,
        });
    }

    let wire: EnvelopeWire = serde_json::from_slice(bytes).map_err(decode_error)?;
    debug_assert_eq!(wire.schema_version, P2A_IMPORT_SCHEMA_VERSION);
    debug_assert_eq!(wire.source_save_version, P2A_SOURCE_SAVE_VERSION);
    debug_assert_eq!(wire.source_game_version, P2A_SOURCE_GAME_VERSION);

    Ok(DecodedP2AEnvelope {
        world: wire.world,
        cadastre: wire.cadastre,
    })
}

pub fn import_envelope_json(bytes: &[u8]) -> Result<P2AMirror, P2AError> {
    let decoded = decode_envelope_json(bytes)?;
    let world = WorldMirror::try_from(decoded.world)?;
    let cadastre = CadastralGraph::try_from_snapshot(decoded.cadastre)?;
    Ok(P2AMirror { world, cadastre })
}

fn decode_error(error: serde_json::Error) -> P2AError {
    P2AError::Decode {
        message: error.to_string(),
    }
}
