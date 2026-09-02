#include <civic/bridge/transport_c_api.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

int main(void) {
    cf_transport_handle* engine = cf_transport_create();
    if (!engine) return 1;
    cf_legacy_road_cell cells[] = {
        {0,0,CF_ROAD_LOCAL,0,CF_DIRECTION_FORWARD},
        {1,0,CF_ROAD_COLLECTOR,0,CF_DIRECTION_FORWARD},
        {2,0,CF_ROAD_ARTERIAL,0,CF_DIRECTION_FORWARD},
    };
    if (cf_transport_load_legacy_roads(engine, cells, 3, 42) != CF_OK) return 2;
    uint64_t hash = cf_transport_domain_hash(engine);
    if (hash == 0) return 3;
    cf_buffer route = {0};
    if (cf_transport_find_route_json(engine, "j:legacy:0,0", "j:legacy:2,0", CF_VEHICLE_PRIVATE_CAR, &route) != CF_OK) return 4;
    if (!route.data || route.size == 0 || strstr((const char*)route.data, "carriagewayIds") == NULL) return 5;
    cf_buffer_free(&route);
    cf_buffer snapshot = {0};
    if (cf_transport_get_snapshot_json(engine, &snapshot) != CF_OK) return 6;
    if (!snapshot.data || strstr((const char*)snapshot.data, "topologyRevision") == NULL) return 7;
    if (strstr((const char*)snapshot.data, "\"junctions\"") == NULL) return 8;
    if (strstr((const char*)snapshot.data, "\"movements\"") == NULL) return 9;
    cf_buffer_free(&snapshot);
    cf_transport_destroy(engine);
    puts("transport c api smoke passed");
    return 0;
}
