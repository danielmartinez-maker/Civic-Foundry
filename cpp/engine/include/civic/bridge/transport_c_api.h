#ifndef CIVIC_TRANSPORT_C_API_H
#define CIVIC_TRANSPORT_C_API_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct cf_transport_handle cf_transport_handle;
typedef enum cf_result { CF_OK = 0, CF_INVALID_ARGUMENT = 1, CF_NOT_FOUND = 2, CF_INVALID_STATE = 3, CF_INTERNAL_ERROR = 4 } cf_result;
typedef enum cf_road_class { CF_ROAD_LOCAL = 0, CF_ROAD_COLLECTOR = 1, CF_ROAD_ARTERIAL = 2 } cf_road_class;
typedef enum cf_direction { CF_DIRECTION_FORWARD = 0, CF_DIRECTION_BACKWARD = 1 } cf_direction;
enum { CF_VEHICLE_PRIVATE_CAR = 1u << 0, CF_VEHICLE_TAXI_RIDE_HAIL = 1u << 1, CF_VEHICLE_LIGHT_COMMERCIAL = 1u << 2, CF_VEHICLE_HEAVY_FREIGHT = 1u << 3, CF_VEHICLE_BUS = 1u << 4, CF_VEHICLE_EMERGENCY = 1u << 5, CF_VEHICLE_BICYCLE = 1u << 6 };

typedef struct cf_legacy_road_cell { int32_t x; int32_t y; cf_road_class road_class; uint8_t one_way; cf_direction one_way_direction; } cf_legacy_road_cell;
typedef struct cf_buffer { uint8_t* data; size_t size; } cf_buffer;

cf_transport_handle* cf_transport_create(void);
void cf_transport_destroy(cf_transport_handle* handle);
cf_result cf_transport_load_legacy_roads(cf_transport_handle* handle, const cf_legacy_road_cell* cells, size_t count, uint64_t source_revision);
cf_result cf_transport_find_route_json(cf_transport_handle* handle, const char* start_junction_id, const char* end_junction_id, uint32_t permission_mask, cf_buffer* out_route_json);
cf_result cf_transport_get_snapshot_json(cf_transport_handle* handle, cf_buffer* out_snapshot_json);
uint64_t cf_transport_domain_hash(const cf_transport_handle* handle);
cf_result cf_transport_get_last_error(const cf_transport_handle* handle, cf_buffer* out_error);
void cf_buffer_free(cf_buffer* buffer);

#ifdef __cplusplus
}
#endif
#endif
