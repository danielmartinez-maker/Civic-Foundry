#include <gtest/gtest.h>

#include <cstring>
#include <string>
#include <vector>

#include <civic/core/NativeEngine.hpp>

namespace {

const std::string kAuthorityTransferSave = R"({"saveVersion":9,"gameVersion":"0.9.0-urban-fabric","seed":7,"clock":{"tick":11,"speed":1},"terrain":{},"world":{},"roads":{"revision":7,"cells":[{"x":0,"y":0,"type":"local"},{"x":1,"y":0,"type":"collector"}]},"urbanFabric":{"parcels":[],"lineage":[]},"zoningV2":{"parcelAssignments":[]},"buildingsV2":[],"propertyMarket":{"holdings":[],"transactions":[],"nextTransactionId":1}})";

std::vector<std::byte> bytes(std::string_view text) {
    std::vector<std::byte> result(text.size());
    std::memcpy(result.data(), text.data(), text.size());
    return result;
}

} // namespace

TEST(NativeTransportationAuthorityTransfer, CommandsMutateOwnedNetworkAndPublishSnapshot) {
    auto engine = civic::NativeEngine::create({7, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(engine);
    ASSERT_TRUE((*engine)->loadV9(kAuthorityTransferSave));
    auto before = (*engine)->domainHash("transportation");
    ASSERT_TRUE(before);

    const std::string payload = R"({"revision":8,"cells":[{"x":0,"y":0,"roadClass":"local"},{"x":1,"y":0,"roadClass":"collector"},{"x":2,"y":0,"roadClass":"arterial"}]})";
    const std::vector<civic::CommandEnvelope> commands{{1, 12, "transport.legacy_roads.replace", bytes(payload)}};
    ASSERT_TRUE((*engine)->submit(commands));
    ASSERT_TRUE((*engine)->step(1));

    auto after = (*engine)->domainHash("transportation");
    ASSERT_TRUE(after);
    EXPECT_NE(after->value, before->value);

    auto snapshot = (*engine)->snapshot();
    ASSERT_TRUE(snapshot);
    EXPECT_NE(snapshot->json.find("\"transportation\""), std::string::npos);
    EXPECT_NE(snapshot->json.find("j:legacy:2,0"), std::string::npos);
    EXPECT_NE(snapshot->json.find("\"topologyRevision\":8"), std::string::npos);
}

TEST(NativeTransportationAuthorityTransfer, SaveV9SerializesCurrentNativeRoadProjection) {
    auto engine = civic::NativeEngine::create({7, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(engine);
    ASSERT_TRUE((*engine)->loadV9(kAuthorityTransferSave));

    const std::string payload = R"({"revision":9,"cells":[{"x":0,"y":0,"roadClass":"local"},{"x":0,"y":1,"roadClass":"arterial"}]})";
    const std::vector<civic::CommandEnvelope> commands{{1, 12, "transport.legacy_roads.replace", bytes(payload)}};
    ASSERT_TRUE((*engine)->submit(commands));
    ASSERT_TRUE((*engine)->step(1));

    auto saved = (*engine)->saveV9();
    ASSERT_TRUE(saved);
    EXPECT_NE(saved->find("\"revision\":9"), std::string::npos);
    EXPECT_NE(saved->find("\"x\":0,\"y\":1,\"type\":\"arterial\""), std::string::npos);
    EXPECT_EQ(saved->find("\"x\":1,\"y\":0,\"type\":\"collector\""), std::string::npos);
}

TEST(NativeTransportationAuthorityTransfer, UnknownTransportCommandsFailTransactionally) {
    auto engine = civic::NativeEngine::create({7, 0, civic::SpeedMode::normal});
    ASSERT_TRUE(engine);
    ASSERT_TRUE((*engine)->loadV9(kAuthorityTransferSave));
    auto before = (*engine)->domainHash("transportation");
    ASSERT_TRUE(before);

    const std::vector<civic::CommandEnvelope> commands{{1, 12, "transport.not_a_command", bytes("{}")}};
    ASSERT_TRUE((*engine)->submit(commands));
    const auto stepped = (*engine)->step(1);
    ASSERT_FALSE(stepped);
    EXPECT_EQ(stepped.error().code, civic::ErrorCode::invalid_argument);

    auto after = (*engine)->domainHash("transportation");
    ASSERT_TRUE(after);
    EXPECT_EQ(after->value, before->value);
    EXPECT_EQ((*engine)->tick(), 11U);
}
