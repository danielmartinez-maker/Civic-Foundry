    try{size_t argc=4;napi_value argv[4]{};check_napi(env,napi_get_cb_info(env,info,&argc,argv,nullptr,nullptr),"route args");if(argc<4)throw std::runtime_error("findRouteJson requires session,start,end,permissions");auto* h=require_session(env,argv[0]);uint32_t permissions{};check_napi(env,napi_get_value_uint32(env,argv[3],&permissions),"permissions");cf_buffer out{};require_cf(env,h,cf_transport_find_route_json(h,get_string(env,argv[1]).c_str(),get_string(env,argv[2]).c_str(),permissions,&out));std::string text(reinterpret_cast<const char*>(out.data),out.size);cf_buffer_free(&out);return make_string(env,text);}catch(const std::exception&e){bool pending=false;napi_is_exception_pending(env,&pending);if(!pending)throw_js(env,e);return nullptr;}}
napi_value snapshot_json(napi_env env,napi_callback_info info){
    try{size_t argc=1;napi_value argv[1]{};check_napi(env,napi_get_cb_info(env,info,&argc,argv,nullptr,nullptr),"snapshot args");if(argc<1)throw std::runtime_error("snapshotJson requires session");auto* h=require_session(env,argv[0]);cf_buffer out{};require_cf(env,h,cf_transport_get_snapshot_json(h,&out));std::string text(reinterpret_cast<const char*>(out.data),out.size);cf_buffer_free(&out);return make_string(env,text);}catch(const std::exception&e){bool pending=false;napi_is_exception_pending(env,&pending);if(!pending)throw_js(env,e);return nullptr;}}
napi_value domain_hash(napi_env env,napi_callback_info info){
    try{size_t argc=1;napi_value argv[1]{};check_napi(env,napi_get_cb_info(env,info,&argc,argv,nullptr,nullptr),"hash args");if(argc<1)throw std::runtime_error("domainHash requires session");const auto hash=cf_transport_domain_hash(require_session(env,argv[0]));napi_value out{};check_napi(env,napi_create_bigint_uint64(env,hash,&out),"bigint");return out;}catch(const std::exception&e){throw_js(env,e);return nullptr;}}

napi_value init(napi_env env,napi_value exports){
    napi_property_descriptor props[]{
        {"create",nullptr,create,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"destroy",nullptr,destroy,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"loadLegacyRoads",nullptr,load_legacy_roads,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"findRouteJson",nullptr,find_route,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"snapshotJson",nullptr,snapshot_json,nullptr,nullptr,nullptr,napi_default,nullptr},
        {"domainHash",nullptr,domain_hash,nullptr,nullptr,nullptr,napi_default,nullptr},
    };
    check_napi(env,napi_define_properties(env,exports,sizeof(props)/sizeof(props[0]),props),"define transport exports");return exports;
}
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
