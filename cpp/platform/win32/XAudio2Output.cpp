#ifdef _WIN32

#include <civic/presentation/XAudio2Output.hpp>

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <xaudio2.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <memory>
#include <numbers>
#include <string>
#include <vector>

namespace civic::presentation {
namespace {

constexpr std::size_t kBusCount = 9U;
constexpr std::uint32_t kSampleRate = 22050U;
constexpr std::size_t kSamplesPerLoop = 22050U;

std::string hresultMessage(const char* prefix, HRESULT result) {
    return std::string(prefix) + " (HRESULT=" + std::to_string(static_cast<long>(result)) + ")";
}

std::array<float, kBusCount> mixVolumes(const AudioMix& mix) noexcept {
    return {
        mix.traffic,
        mix.freight,
        mix.transit,
        mix.construction,
        mix.industrial,
        mix.neighborhood,
        mix.emergency,
        mix.water_weather,
        mix.music,
    };
}

std::vector<std::int16_t> synthLoop(std::size_t bus_index) {
    const std::array<double, kBusCount> frequencies{73.0, 49.0, 131.0, 97.0, 61.0, 181.0, 523.25, 257.0, 220.0};
    const double frequency = frequencies[bus_index];
    std::vector<std::int16_t> samples(kSamplesPerLoop);
    std::uint32_t noise_state = 0x9e3779b9U ^ static_cast<std::uint32_t>(bus_index * 0x45d9f3bU);

    for (std::size_t sample_index = 0; sample_index < samples.size(); ++sample_index) {
        const double time = static_cast<double>(sample_index) / static_cast<double>(kSampleRate);
        const double tone = std::sin(2.0 * std::numbers::pi * frequency * time);
        noise_state = noise_state * 1664525U + 1013904223U;
        const double noise = (static_cast<double>((noise_state >> 8U) & 0xffffU) / 32767.5) - 1.0;
        const double texture = bus_index == 7U ? (0.30 * tone + 0.70 * noise) : (0.82 * tone + 0.18 * noise);
        samples[sample_index] = static_cast<std::int16_t>(std::clamp(texture * 1300.0, -32767.0, 32767.0));
    }
    return samples;
}

} // namespace

struct XAudio2Output::Impl {
    IXAudio2* engine{};
    IXAudio2MasteringVoice* mastering_voice{};
    std::array<IXAudio2SourceVoice*, kBusCount> voices{};
    std::array<std::vector<std::int16_t>, kBusCount> samples{};

    ~Impl() {
        for (auto*& voice : voices) {
            if (voice) {
                voice->Stop(0U);
                voice->DestroyVoice();
                voice = nullptr;
            }
        }
        if (mastering_voice) {
            mastering_voice->DestroyVoice();
            mastering_voice = nullptr;
        }
        if (engine) {
            engine->Release();
            engine = nullptr;
        }
    }
};

XAudio2Output::XAudio2Output(std::unique_ptr<Impl> impl) noexcept : impl_(std::move(impl)) {}
XAudio2Output::~XAudio2Output() = default;
XAudio2Output::XAudio2Output(XAudio2Output&&) noexcept = default;
XAudio2Output& XAudio2Output::operator=(XAudio2Output&&) noexcept = default;

std::expected<XAudio2Output, std::string> XAudio2Output::create() {
    auto impl = std::make_unique<Impl>();

    HRESULT result = XAudio2Create(&impl->engine, 0U, XAUDIO2_DEFAULT_PROCESSOR);
    if (FAILED(result)) return std::unexpected(hresultMessage("XAudio2Create failed", result));

    result = impl->engine->CreateMasteringVoice(&impl->mastering_voice);
    if (FAILED(result)) return std::unexpected(hresultMessage("XAudio2 mastering voice creation failed", result));

    WAVEFORMATEX format{};
    format.wFormatTag = WAVE_FORMAT_PCM;
    format.nChannels = 1U;
    format.nSamplesPerSec = kSampleRate;
    format.wBitsPerSample = 16U;
    format.nBlockAlign = static_cast<WORD>(format.nChannels * format.wBitsPerSample / 8U);
    format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;

    for (std::size_t bus_index = 0; bus_index < kBusCount; ++bus_index) {
        impl->samples[bus_index] = synthLoop(bus_index);
        result = impl->engine->CreateSourceVoice(&impl->voices[bus_index], &format, 0U, 1.0F);
        if (FAILED(result)) return std::unexpected(hresultMessage("XAudio2 source voice creation failed", result));

        XAUDIO2_BUFFER buffer{};
        buffer.AudioBytes = static_cast<UINT32>(impl->samples[bus_index].size() * sizeof(std::int16_t));
        buffer.pAudioData = reinterpret_cast<const BYTE*>(impl->samples[bus_index].data());
        buffer.LoopCount = XAUDIO2_LOOP_INFINITE;
        result = impl->voices[bus_index]->SubmitSourceBuffer(&buffer);
        if (FAILED(result)) return std::unexpected(hresultMessage("XAudio2 source buffer submission failed", result));
        result = impl->voices[bus_index]->SetVolume(0.0F);
        if (FAILED(result)) return std::unexpected(hresultMessage("XAudio2 initial bus volume failed", result));
        result = impl->voices[bus_index]->Start(0U);
        if (FAILED(result)) return std::unexpected(hresultMessage("XAudio2 source voice start failed", result));
    }

    return XAudio2Output(std::move(impl));
}

bool XAudio2Output::initialized() const noexcept {
    return impl_ && impl_->engine && impl_->mastering_voice;
}

std::expected<void, std::string> XAudio2Output::apply(const AudioMix& mix) {
    if (!initialized()) return std::unexpected("XAudio2 output is not initialized");
    const auto volumes = mixVolumes(mix);
    for (std::size_t bus_index = 0; bus_index < kBusCount; ++bus_index) {
        if (!impl_->voices[bus_index]) return std::unexpected("XAudio2 bus voice is unavailable");
        const HRESULT result = impl_->voices[bus_index]->SetVolume(std::clamp(volumes[bus_index], 0.0F, 1.0F));
        if (FAILED(result)) return std::unexpected(hresultMessage("XAudio2 bus volume update failed", result));
    }
    return {};
}

} // namespace civic::presentation

#endif
