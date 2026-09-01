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
add_library(civic_engine STATIC
  engine/src/geometry/Geometry.cpp
  engine/src/geometry/BooleanOps.cpp
  engine/src/world/Terrain.cpp
  engine/src/world/Hydrology.cpp
  engine/src/world/WorldFoundation.cpp
  engine/src/cadastre/Cadastre.cpp
  engine/src/cadastre/CadastreMutation.cpp
  engine/src/cadastre/ParcelGeneration.cpp
  engine/src/urban/UrbanFabric.cpp
)
target_include_directories(civic_engine PUBLIC engine/include)
target_link_libraries(civic_engine PUBLIC nlohmann_json::nlohmann_json Clipper2::Clipper2)
if(MSVC)
  target_compile_options(civic_engine PRIVATE /W4 /permissive- /EHsc)
else()
  target_compile_options(civic_engine PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow)
endif()
if(CIVIC_ENABLE_SANITIZERS AND NOT MSVC)
  target_compile_options(civic_engine PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
  target_link_options(civic_engine PRIVATE -fsanitize=address,undefined)
endif()
if(CIVIC_BUILD_TESTS)
  enable_testing()
  find_package(GTest CONFIG REQUIRED)
  add_executable(civic_engine_tests
    tests/contract_red_tests.cpp
    tests/world_foundation_tests.cpp
    tests/cadastre_mutation_tests.cpp
    tests/parcel_generation_tests.cpp
    tests/legal_history_tests.cpp
    tests/legal_history_row_tests.cpp
    tests/transactional_mutation_tests.cpp
    tests/legacy_projection_tests.cpp
  )
  target_link_libraries(civic_engine_tests PRIVATE civic_engine GTest::gtest_main)
  include(GoogleTest)
  gtest_discover_tests(civic_engine_tests)
endif()
