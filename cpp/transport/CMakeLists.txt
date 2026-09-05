cmake_minimum_required(VERSION 3.30)
project(civic_transport_native LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

option(CIVIC_TRANSPORT_ENABLE_SANITIZERS "Enable ASan/UBSan for transport tests" OFF)
option(CIVIC_TRANSPORT_BUILD_NAPI "Build the transport Node-API smoke binding" OFF)

set(CIVIC_CPP_ROOT "${CMAKE_CURRENT_LIST_DIR}/..")
set(CIVIC_ENGINE_INCLUDE "${CIVIC_CPP_ROOT}/engine/include")

add_library(civic_transport STATIC
  "${CIVIC_CPP_ROOT}/engine/src/transport/transport_engine.cpp"
  "${CIVIC_CPP_ROOT}/engine/src/bridge/transport_c_api.cpp"
)
target_include_directories(civic_transport PUBLIC "${CIVIC_ENGINE_INCLUDE}")

function(civic_transport_warnings target)
  if(MSVC)
    target_compile_options(${target} PRIVATE /W4 /permissive- /EHsc)
  else()
    target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic -Wconversion -Wshadow -Werror)
  endif()
endfunction()

function(civic_transport_sanitizers target)
  if(CIVIC_TRANSPORT_ENABLE_SANITIZERS AND NOT MSVC)
    target_compile_options(${target} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
    target_link_options(${target} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
  endif()
endfunction()

civic_transport_warnings(civic_transport)
civic_transport_sanitizers(civic_transport)

enable_testing()
add_executable(civic_transport_tests "${CIVIC_CPP_ROOT}/tests/transport/transport_tests.cpp")
target_link_libraries(civic_transport_tests PRIVATE civic_transport)
civic_transport_warnings(civic_transport_tests)
civic_transport_sanitizers(civic_transport_tests)
add_test(NAME civic_transport_tests COMMAND civic_transport_tests)

add_executable(civic_transport_c_api_smoke "${CIVIC_CPP_ROOT}/tests/transport/transport_c_api_smoke.c")
target_link_libraries(civic_transport_c_api_smoke PRIVATE civic_transport)
set_target_properties(civic_transport_c_api_smoke PROPERTIES LINKER_LANGUAGE CXX)
civic_transport_warnings(civic_transport_c_api_smoke)
civic_transport_sanitizers(civic_transport_c_api_smoke)
add_test(NAME civic_transport_c_api_smoke COMMAND civic_transport_c_api_smoke)

add_executable(civic_transport_fixture_runner "${CIVIC_CPP_ROOT}/tests/transport/transport_fixture_runner.cpp")
target_link_libraries(civic_transport_fixture_runner PRIVATE civic_transport)
civic_transport_warnings(civic_transport_fixture_runner)
civic_transport_sanitizers(civic_transport_fixture_runner)
add_test(NAME civic_transport_fixture_runner COMMAND civic_transport_fixture_runner)

if(CIVIC_TRANSPORT_BUILD_NAPI)
  set(CIVIC_NODE_INCLUDE_DIR "" CACHE PATH "Directory containing node_api.h")
  if(NOT EXISTS "${CIVIC_NODE_INCLUDE_DIR}/node_api.h")
    message(FATAL_ERROR "CIVIC_TRANSPORT_BUILD_NAPI requires -DCIVIC_NODE_INCLUDE_DIR=<node include directory>")
  endif()
  add_library(civic_transport_napi MODULE "${CIVIC_CPP_ROOT}/bindings/napi/transport_napi.cpp")
  target_include_directories(civic_transport_napi PRIVATE "${CIVIC_ENGINE_INCLUDE}" "${CIVIC_NODE_INCLUDE_DIR}")
  target_link_libraries(civic_transport_napi PRIVATE civic_transport)
  set_target_properties(civic_transport_napi PROPERTIES PREFIX "" SUFFIX ".node")
  civic_transport_warnings(civic_transport_napi)
endif()
