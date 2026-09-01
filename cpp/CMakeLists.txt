cmake_minimum_required(VERSION 3.30)
project(civic_foundry_native LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(CIVIC_ENABLE_SANITIZERS "Enable native sanitizers" OFF)
option(CIVIC_BUILD_TESTS "Build native tests" ON)
option(CIVIC_BUILD_NAPI "Build Node-API addon" OFF)
option(CIVIC_BUILD_WASM "Build WebAssembly bridge" OFF)

find_package(nlohmann_json CONFIG REQUIRED)
find_package(Clipper2 CONFIG REQUIRED)

if(CIVIC_BUILD_TESTS)
  enable_testing()
  find_package(GTest CONFIG REQUIRED)
  add_executable(civic_engine_tests tests/contract_red_tests.cpp)
  target_include_directories(civic_engine_tests PRIVATE engine/include)
  target_link_libraries(civic_engine_tests PRIVATE GTest::gtest_main nlohmann_json::nlohmann_json Clipper2::Clipper2)
  include(GoogleTest)
  gtest_discover_tests(civic_engine_tests)
endif()
