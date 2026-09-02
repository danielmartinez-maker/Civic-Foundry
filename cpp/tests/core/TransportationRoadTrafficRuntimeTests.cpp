#include <gtest/gtest.h>

#include <cstring>
#include <string>
#include <string_view>
#include <vector>

#include <civic/core/NativeEngine.hpp>

namespace {

const std::string kRoadTrafficRuntimeSave = R"({"saveVersion":9,"gameVersion":"0.9.0-urban-fabric","seed":19,"clock":{"tick":11,"speed":1},"terrain":{},"world":{},"roads":{"revision":3,"cells":[{"x":0,"y":0,"type":"local"},{"x":1,"y":0,"type":"local"},{"x":2,"y":0,"type":"local"}]},"urbanFabric":{"parcels":[],"lineage":[]},"zoningV2":{"parcelAssignments":[]},"buildingsV2":[],"propertyMarket":{"holdings":[],"transactions":[],"nextTransactionId":1}})";

std::vector<std::byte> commandBytes(std::string_view text) {
    std::vector<std::byte> result(text.size());
    std::memcpy(result.data(), text.data(), text.size());
    return result;
}

} // namespace

TEST(NativeTransportationRoadTraffic, CommandRoutesAndAdvancesTripInsideNativeAuthority) {
    auto engine = civic::NativeEngine::create({19, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(engine);
    ASSERT_TRUE((*engine)->loadV9(kRoadTrafficRuntimeSave));

    const std::string payload = R"({"tripId":"trip:command-runtime","cause":"commute","travelerWeight":2.5,"originId":"building:home","destinationId":"building:work","startJunctionId":"j:legacy:0,0","endJunctionId":"j:legacy:2,0"})";
    const std::vector<civic::CommandEnvelope> commands{{1, 12, "transport.road_trip.submit", commandBytes(payload)}};
    ASSERT_TRUE((*engine)->submit(commands));
    ASSERT_TRUE((*engine)->step(1));

    auto active = (*engine)->snapshot();
    ASSERT_TRUE(active);
    EXPECT_NE(active->json.find("trip:command-runtime"), std::string::npos);
    EXPECT_NE(active->json.find("\"weightedVehicles\":2.5"), std::string::npos);

    ASSERT_TRUE((*engine)->step(20));
    auto completed = (*engine)->snapshot();
    ASSERT_TRUE(completed);
    EXPECT_EQ(completed->json.find("trip:command-runtime"), std::string::npos);
    EXPECT_NE(completed->json.find("\"completedTrips\":1"), std::string::npos);
    EXPECT_NE(completed->json.find("\"failedTrips\":0"), std::string::npos);
}

TEST(NativeTransportationRoadTraffic, SameNodeCommandCompletesWithoutCreatingVehicle) {
    auto engine = civic::NativeEngine::create({19, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(engine);
    ASSERT_TRUE((*engine)->loadV9(kRoadTrafficRuntimeSave));

    const std::string payload = R"({"tripId":"trip:same-node-command","cause":"shopping","travelerWeight":1.25,"originId":"building:shopper","destinationId":"building:shopper","startJunctionId":"j:legacy:1,0","endJunctionId":"j:legacy:1,0"})";
    const std::vector<civic::CommandEnvelope> commands{{1, 12, "transport.road_trip.submit", commandBytes(payload)}};
    ASSERT_TRUE((*engine)->submit(commands));
    ASSERT_TRUE((*engine)->step(1));

    auto snapshot = (*engine)->snapshot();
    ASSERT_TRUE(snapshot);
    EXPECT_EQ(snapshot->json.find("trip:same-node-command"), std::string::npos);
    EXPECT_NE(snapshot->json.find("\"completedTrips\":1"), std::string::npos);
}
