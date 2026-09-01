#include <node_api.h>
#include <civic/bridge/transport_c_api.h>

#include <cstdint>
#include <map>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
struct TransportDeleter { void operator()(cf_transport_handle* h) const { cf_transport_destroy(h); } };
using TransportPtr = std::unique_ptr<cf_transport_handle,TransportDeleter>;
std::map<std::uint64_t,TransportPtr> sessions;
std::uint64_t next_session = 1;

void check_napi(napi_env env, napi_status status, const char* what) {
    if (status == ::napi_ok) return;
    const napi_extended_error_info* info = nullptr;
    napi_get_last_error_info(env,&info);
    throw std::runtime_error(std::string(what)+": "+(info&&info->error_message?info->error_message:"napi error"));
}
void throw_js(napi_env env, const std::exception& e) { napi_throw_error(env,"CF_TRANSPORT",e.what()); }
std::uint64_t session_id(napi_env env,napi_value value) {
    double raw{}; check_napi(env,napi_get_value_double(env,value,&raw),"session id");
    if (raw < 1 || raw > 9007199254740991.0 || raw != static_cast<double>(static_cast<std::uint64_t>(raw))) throw std::runtime_error("invalid transport session id");
    return static_cast<std::uint64_t>(raw);
}
cf_transport_handle* require_session(napi_env env,napi_value value) {
    const auto id=session_id(env,value); auto it=sessions.find(id); if(it==sessions.end()) throw std::runtime_error("unknown transport session"); return it->second.get();
}
napi_value make_number(napi_env env,double v){napi_value out{};check_napi(env,napi_create_double(env,v,&out),"create number");return out;}
napi_value make_string(napi_env env,const std::string& v){napi_value out{};check_napi(env,napi_create_string_utf8(env,v.c_str(),v.size(),&out),"create string");return out;}
std::string get_string(napi_env env,napi_value value){size_t n{};check_napi(env,napi_get_value_string_utf8(env,value,nullptr,0,&n),"string length");std::string out(n,'\0');size_t written{};check_napi(env,napi_get_value_string_utf8(env,value,out.data(),out.size()+1,&written),"string value");out.resize(written);return out;}
napi_value prop(napi_env env,napi_value object,const char* name){napi_value out{};check_napi(env,napi_get_named_property(env,object,name,&out),name);return out;}
int32_t get_i32(napi_env env,napi_value v){int32_t out{};check_napi(env,napi_get_value_int32(env,v,&out),"int32");return out;}
bool get_bool(napi_env env,napi_value v){bool out{};check_napi(env,napi_get_value_bool(env,v,&out),"bool");return out;}
void require_cf(napi_env env,cf_transport_handle* h,cf_result result){if(result==CF_OK)return;cf_buffer err{};cf_transport_get_last_error(h,&err);std::string text=err.data?reinterpret_cast<const char*>(err.data):"native transport error";cf_buffer_free(&err);napi_throw_error(env,"CF_TRANSPORT",text.c_str());throw std::runtime_error(text);}

napi_value create(napi_env env,napi_callback_info info){
