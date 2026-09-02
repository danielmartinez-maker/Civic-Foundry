#pragma once

#ifdef _WIN32

#include <civic/presentation/Audio.hpp>

#include <expected>
#include <memory>
#include <string>

namespace civic::presentation {

class XAudio2Output final : public IAudioBusOutput {
public:
    [[nodiscard]] static std::expected<XAudio2Output, std::string> create();

    ~XAudio2Output();
    XAudio2Output(XAudio2Output&&) noexcept;
    XAudio2Output& operator=(XAudio2Output&&) noexcept;
    XAudio2Output(const XAudio2Output&) = delete;
    XAudio2Output& operator=(const XAudio2Output&) = delete;

    [[nodiscard]] bool initialized() const noexcept;
    [[nodiscard]] std::expected<void, std::string> apply(const AudioMix& mix) override;

private:
    struct Impl;
    explicit XAudio2Output(std::unique_ptr<Impl> impl) noexcept;
    std::unique_ptr<Impl> impl_;
};

} // namespace civic::presentation

#endif
