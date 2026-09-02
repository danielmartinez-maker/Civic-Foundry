#include <gtest/gtest.h>
#include <civic/persistence/SaveV9.hpp>

namespace {
std::string minimalSave() {
    return R"({"saveVersion":9,"gameVersion":"0.9.0-urban-fabric","seed":7,"clock":{"tick":11,"speed":1},"terrain":{},"world":{},"urbanFabric":{"parcels":[],"lineage":[]},"zoningV2":{"parcelAssignments":[]},"buildingsV2":[],"propertyMarket":{"holdings":[],"transactions":[],"nextTransactionId":1},"unknownCompatibility":{"kept":true}})";
}
}

TEST(SaveV9, ParsesAndPreservesUnknownCompatibilityFieldsCanonically) {
    auto parsed = civic::parseSaveV9(minimalSave()); ASSERT_TRUE(parsed);
    EXPECT_EQ(parsed->seed, 7U); EXPECT_EQ(parsed->tick, 11U); EXPECT_EQ(parsed->speed, civic::SpeedMode::normal);
    EXPECT_NE(parsed->canonicalJson.find("unknownCompatibility"), std::string::npos);
    EXPECT_NE(parsed->inheritedV8.find("\"saveVersion\":8"), std::string::npos);
}

TEST(SaveV9, RejectsWrongVersionDuplicateIdsAndDanglingReferences) {
    auto wrong = minimalSave(); wrong.replace(wrong.find("\"saveVersion\":9"), 15, "\"saveVersion\":8");
    auto wrongResult = civic::parseSaveV9(wrong); ASSERT_FALSE(wrongResult);
    EXPECT_EQ(wrongResult.error().code, civic::ErrorCode::unsupported_save_version);
    auto duplicate = minimalSave();
    const auto pos = duplicate.find("\"parcels\":[]");
    duplicate.replace(pos, 12, "\"parcels\":[{\"id\":\"p1\"},{\"id\":\"p1\"}]");
    EXPECT_FALSE(civic::parseSaveV9(duplicate));
    auto dangling = minimalSave();
    const auto zoning = dangling.find("\"parcelAssignments\":[]");
    dangling.replace(zoning, 22, "\"parcelAssignments\":[{\"parcelId\":\"missing\",\"districtId\":\"R5\"}]");
    EXPECT_FALSE(civic::parseSaveV9(dangling));
}

TEST(SaveV9, HistoricalTransactionMayReferenceRetiredParcelRecordedInLineage) {
    const auto save = R"({"saveVersion":9,"gameVersion":"0.9.0-urban-fabric","seed":7,"clock":{"tick":11,"speed":1},"terrain":{},"world":{},"urbanFabric":{"parcels":[{"id":"p2"}],"lineage":[{"id":"lineage:1","sourceParcelIds":["p1"],"resultingParcelIds":["p2"]}]},"zoningV2":{"parcelAssignments":[]},"buildingsV2":[],"propertyMarket":{"holdings":[],"transactions":[{"id":"tx:1","parcelIds":["p1"]}],"nextTransactionId":2}})";
    EXPECT_TRUE(civic::parseSaveV9(save));
}

TEST(SaveV9, RejectsMalformedInheritedTransitAndEconomyState) {
    const auto badTransit = R"({"saveVersion":9,"gameVersion":"0.9.0-urban-fabric","seed":7,"clock":{"tick":11,"speed":1},"terrain":{},"world":{},"transit":{"network":{"stops":[{"id":"s1"}],"lines":[{"id":"l1","stopIds":["missing"]}]},"mobility":{"passengers":{"queues":[]},"vehicles":{"vehicles":[]},"operations":{"lines":[]}}},"urbanFabric":{"parcels":[],"lineage":[]},"zoningV2":{"parcelAssignments":[]},"buildingsV2":[],"propertyMarket":{"holdings":[],"transactions":[],"nextTransactionId":1}})";
    EXPECT_FALSE(civic::parseSaveV9(badTransit));

    const auto badEconomy = R"({"saveVersion":9,"gameVersion":"0.9.0-urban-fabric","seed":7,"clock":{"tick":11,"speed":1},"terrain":{},"world":{},"economyDomain":{"inventories":{"records":[{"firmId":"f1","commodity":"goods"},{"firmId":"f1","commodity":"goods"}],"cargo":[]},"financials":[]},"urbanFabric":{"parcels":[],"lineage":[]},"zoningV2":{"parcelAssignments":[]},"buildingsV2":[],"propertyMarket":{"holdings":[],"transactions":[],"nextTransactionId":1}})";
    EXPECT_FALSE(civic::parseSaveV9(badEconomy));
}

TEST(SaveV9, RejectsTrailingNonWhitespaceAfterValidObject) {
    EXPECT_FALSE(civic::parseSaveV9(minimalSave() + " garbage"));
    EXPECT_FALSE(civic::parseSaveV9(minimalSave() + " {}"));
    EXPECT_TRUE(civic::parseSaveV9(minimalSave() + "\n\t "));
}

TEST(SaveV9Parity, RejectsEcmaWhitespaceOnlyEntityIds) {
    auto save = minimalSave();
    const auto parcels = save.find("\"parcels\":[]");
    ASSERT_NE(parcels, std::string::npos);
    save.replace(parcels, 12, "\"parcels\":[{\"id\":\"\xC2\xA0\"}]");
    EXPECT_FALSE(civic::parseSaveV9(save));
}
