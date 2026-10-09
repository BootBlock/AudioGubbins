# SPDX-License-Identifier: Apache-2.0
"""Exports a Spleeter release checkpoint, two or four stems, to one ONNX graph.

The graph takes the stereo STFT magnitude of 512-frame segments, bins 0 to
1023 of a 4096-point transform at 44.1 kHz, `x [2, S, 512, 1024]`, and gives
one estimated magnitude per stem, each the U-Net's sigmoid mask times `x`, of
the same shape. The transform, the ratio masks and the inverse are computed
outside it (ADR-0062).

The U-Net is written here from the architecture Deezer's paper and code
describe (Hennequin et al., JOSS 5(50) 2154, 2020; github.com/deezer/spleeter,
MIT), and its weights are read from the TensorFlow checkpoint by their
variable names. Which names belong to which stem's layers (seven
convolutions, six transposed convolutions and twelve batch normalisations per
stem, numbered in stem order, the sixth normalisation computed but unused)
follows the mapping sherpa-onnx's Spleeter scripts established
(github.com/k2-fsa/sherpa-onnx, scripts/spleeter, Apache-2.0, Copyright 2023
Xiaomi Corp.); no code of theirs is copied.

Usage:
    python spleeter.py --stems 2 --checkpoint <dir>/model --output model.onnx

`<dir>` holds the release archive's `model.index`, `model.data-*` and
`checkpoint`. The pack build checks the length and SHA-256 of what this
writes, so any change here, or in the pinned environment, that changes a byte
is a new pack version, never a silent one.

Every attribute name below (`nets`, `enc`, `ebn`, `dec`, `dbn`, `last`)
prefixes weights' names in the graph, so it is part of the file's bytes.
"""

import argparse

import tensorflow as tf
import torch
from torch import nn
from torch.nn import functional

STEMS = {
    2: ["vocals", "accompaniment"],
    4: ["vocals", "drums", "bass", "other"],
}

# The channels of the encoder's six convolutions, input first.
ENCODER_CHANNELS = [2, 16, 32, 64, 128, 256, 512]
DECODER_IN = [512, 512, 256, 128, 64, 32]
DECODER_OUT = [256, 128, 64, 32, 16, 1]


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--stems", type=int, choices=sorted(STEMS), required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


class UNet(nn.Module):
    """One stem's U-Net. The two-stem release activates with leaky ReLU in
    the encoder and ReLU in the decoder, the four-stem one with ELU in both."""

    def __init__(self, elu):
        super().__init__()
        self.enc = nn.ModuleList(
            nn.Conv2d(ENCODER_CHANNELS[i], ENCODER_CHANNELS[i + 1], 5, 2) for i in range(6)
        )
        self.ebn = nn.ModuleList(
            nn.BatchNorm2d(ENCODER_CHANNELS[i + 1], eps=1e-3) for i in range(5)
        )
        self.dec = nn.ModuleList(
            nn.ConvTranspose2d(DECODER_IN[i], DECODER_OUT[i], 5, 2) for i in range(6)
        )
        self.dbn = nn.ModuleList(nn.BatchNorm2d(DECODER_OUT[i], eps=1e-3) for i in range(6))
        self.last = nn.Conv2d(1, 2, 4, dilation=2, padding=3)
        self.elu = elu

    def encoder_activation(self, tensor):
        return functional.elu(tensor) if self.elu else functional.leaky_relu(tensor, 0.2)

    def decoder_activation(self, tensor):
        return functional.elu(tensor) if self.elu else functional.relu(tensor)

    def forward(self, x):
        # x [S, 2, 512, 1024]
        skips = []
        hidden = x
        for i in range(6):
            # TensorFlow's 'same' padding for a stride-2, 5-wide kernel.
            convolved = self.enc[i](functional.pad(hidden, (1, 2, 1, 2)))
            skips.append(convolved)
            if i < 5:
                hidden = self.encoder_activation(self.ebn[i](convolved))
        hidden = skips[5]
        for i in range(6):
            upsampled = self.dec[i](hidden)[:, :, 1:-2, 1:-2]
            upsampled = self.dbn[i](self.decoder_activation(upsampled))
            hidden = torch.cat([skips[4 - i], upsampled], 1) if i < 5 else upsampled
        return torch.sigmoid(self.last(hidden)) * x


class Stems(nn.Module):
    """Every stem's U-Net over one input, one output per stem."""

    def __init__(self, nets):
        super().__init__()
        self.nets = nn.ModuleList(nets)

    def forward(self, x):
        # x [2, S, 512, 1024], the channels first as the processor holds them.
        segments = x.permute(1, 0, 2, 3)
        return tuple(net(segments).permute(1, 0, 2, 3) for net in self.nets)


def variable(base, number):
    """A checkpoint variable's name: TensorFlow numbers the second and later
    layers of a kind `<base>_<n>` and leaves the first bare."""
    return base if number == 0 else f"{base}_{number}"


def stem_state(reader, stem):
    def tensor(name):
        return torch.from_numpy(reader.get_tensor(name))

    def kernel(name):
        # TensorFlow keeps (height, width, in, out); torch (out, in, height, width).
        return tensor(name).permute(3, 2, 0, 1)

    state = {}
    for j in range(6):
        conv = variable("conv2d", 7 * stem + j)
        state[f"enc.{j}.weight"] = kernel(f"{conv}/kernel")
        state[f"enc.{j}.bias"] = tensor(f"{conv}/bias")
        transposed = variable("conv2d_transpose", 6 * stem + j)
        state[f"dec.{j}.weight"] = kernel(f"{transposed}/kernel")
        state[f"dec.{j}.bias"] = tensor(f"{transposed}/bias")
    last = variable("conv2d", 7 * stem + 6)
    state["last.weight"] = kernel(f"{last}/kernel")
    state["last.bias"] = tensor(f"{last}/bias")
    for j in range(12):
        if j == 5:
            # Follows the bottleneck convolution, whose output the decoder
            # takes before normalisation, so it changes nothing.
            continue
        norm = variable("batch_normalization", 12 * stem + j)
        prefix = f"ebn.{j}" if j < 5 else f"dbn.{j - 6}"
        state[f"{prefix}.weight"] = tensor(f"{norm}/gamma")
        state[f"{prefix}.bias"] = tensor(f"{norm}/beta")
        state[f"{prefix}.running_mean"] = tensor(f"{norm}/moving_mean")
        state[f"{prefix}.running_var"] = tensor(f"{norm}/moving_variance")
    return state


def build_model(stems, checkpoint):
    reader = tf.train.load_checkpoint(checkpoint)
    nets = []
    for stem in range(len(STEMS[stems])):
        net = UNet(elu=stems == 4).eval()
        state = stem_state(reader, stem)
        # The batch counters are training state the checkpoint does not hold.
        state.update({k: v for k, v in net.state_dict().items() if "num_batches" in k})
        net.load_state_dict(state, strict=True)
        nets.append(net)
    return Stems(nets).eval()


def main():
    arguments = parse_arguments()
    names = STEMS[arguments.stems]
    model = build_model(arguments.stems, arguments.checkpoint)
    # One segment traces the graph; its values do not reach it.
    example = torch.zeros(2, 1, 512, 1024)
    torch.onnx.export(
        model,
        (example,),
        arguments.output,
        input_names=["x"],
        output_names=names,
        dynamic_axes={"x": {1: "S"}, **{name: {1: "S"} for name in names}},
        opset_version=17,
        dynamo=False,
    )


if __name__ == "__main__":
    main()
