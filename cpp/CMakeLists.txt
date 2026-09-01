cmake_minimum_required(VERSION 3.30)
project(civic_foundry_native LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

include(cmake/CivicOptions.cmake)
include(cmake/CivicWarnings.cmake)
include(cmake/CivicSanitizers.cmake)

find_package(json-c CONFIG QUIET)
if(TARGET json-c::json-c)
  set(CIVIC_JSON_TARGET json-c::json-c)
else()
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(JSONC REQUIRED IMPORTED_TARGET json-c)
  set(CIVIC_JSON_TARGET PkgConfig::JSONC)
endif()

add_library(civic_engine STATIC
  engine/src/core/Kernel.cpp
  engine/src/core/NativeEngine.cpp
  engine/src/core/RandomStreamRegistry.cpp
  engine/src/persistence/SaveV9.cpp
  engine/src/bridge/civic_engine.cpp
)
target_include_directories(civic_engine PUBLIC engine/include)
target_link_libraries(civic_engine PUBLIC ${CIVIC_JSON_TARGET})
target_compile_definitions(civic_engine PUBLIC CIVIC_ENGINE_STATIC)
civic_enable_warnings(civic_engine)
civic_enable_sanitizers(civic_engine)

if(CIVIC_BUILD_TESTS)
  enable_testing()
  find_package(GTest CONFIG REQUIRED)
  add_executable(civic_engine_tests
    tests/core/CoreTests.cpp
    tests/persistence/SaveV9Tests.cpp
    tests/parity/ParityTests.cpp
  )
  target_link_libraries(civic_engine_tests PRIVATE civic_engine GTest::gtest_main ${CIVIC_JSON_TARGET})
  civic_enable_warnings(civic_engine_tests)
  civic_enable_sanitizers(civic_engine_tests)
  add_executable(civic_c_abi_smoke tests/parity/c_abi_smoke.c)
  target_link_libraries(civic_c_abi_smoke PRIVATE civic_engine)
  add_test(NAME civic_c_abi_smoke COMMAND civic_c_abi_smoke)
  include(GoogleTest)
  gtest_discover_tests(civic_engine_tests)
endif()

if(CIVIC_BUILD_NAPI)
  find_program(NODE_EXECUTABLE node REQUIRED)
  execute_process(COMMAND ${NODE_EXECUTABLE} -p "require('path').resolve(process.execPath,'..','..','include','node')" OUTPUT_VARIABLE NODE_INCLUDE_DIR OUTPUT_STRIP_TRAILING_WHITESPACE)
  if(NOT EXISTS "${NODE_INCLUDE_DIR}/node_api.h")
    message(FATAL_ERROR "node_api.h not found at ${NODE_INCLUDE_DIR}")
  endif()
  add_library(civic_native MODULE bindings/napi/civic_native.cpp)
  target_include_directories(civic_native PRIVATE engine/include "${NODE_INCLUDE_DIR}")
  target_link_libraries(civic_native PRIVATE civic_engine)
  set_target_properties(civic_native PROPERTIES PREFIX "" SUFFIX ".node")
  civic_enable_warnings(civic_native)
  if(CIVIC_BUILD_TESTS)
    add_test(NAME civic_napi_smoke COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/bindings/napi/test.mjs $<TARGET_FILE:civic_native>)
  endif()
endif()

if(CIVIC_BUILD_WASM)
  if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "CIVIC_BUILD_WASM requires the Emscripten toolchain")
  endif()
  add_executable(civic_wasm bindings/wasm/civic_wasm.cpp)
  target_link_libraries(civic_wasm PRIVATE civic_engine)
  set_target_properties(civic_wasm PROPERTIES SUFFIX ".js")
endif()
