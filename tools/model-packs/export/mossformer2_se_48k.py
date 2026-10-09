# SPDX-License-Identifier: Apache-2.0
"""Exports MossFormer2 SE 48K's checkpoint to one ONNX graph.

The graph takes the Kaldi filter-bank features with their deltas,
`fbanks [1, T, 180]`, and gives the mask over the 961 bins of the 48 kHz
spectrum, `mask [1, T, 961]`; the features and the masking are computed
outside it (ADR-0062). The model's own code is ClearerVoice-Studio's,
Apache-2.0, fetched at its pinned commit by the pack build and imported from
the directory named by `--clearvoice`, never kept here.

Usage:
    python mossformer2_se_48k.py --checkpoint last_best_checkpoint.pt \
        --clearvoice <dir holding models/mossformer2_se> --output model.onnx

The pack build checks the length and SHA-256 of what this writes, so any
change here, or in the pinned environment, that changes a byte is a new
pack version, never a silent one.
"""

import argparse
import sys

import torch


def parse_arguments():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--clearvoice", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


class MaskOnly(torch.nn.Module):
    """The network with its mask alone as the output, which is all the
    processor reads: the enhanced features it also gives are unused.

    The attribute's name, `m`, prefixes every weight's name in the graph, so
    it is part of the file's bytes and its recorded hash."""

    def __init__(self, network):
        super().__init__()
        self.m = network

    def forward(self, fbanks):
        return self.m(fbanks)[-1]


def load_network(checkpoint_path):
    # Imported here, once `--clearvoice` is on the path.
    from models.mossformer2_se.mossformer2_se_wrapper import MossFormer2_SE_48K

    network = MossFormer2_SE_48K(None).model.eval()
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
    state = checkpoint.get("model", checkpoint)
    # The checkpoint was saved from a DataParallel wrapper.
    state = {key.replace("module.", ""): value for key, value in state.items()}
    network.load_state_dict(state, strict=True)
    return network


def uncache_rotary_embeddings(network):
    """Stops each rotary embedding caching its frequencies for the first
    sequence length it sees: traced with the cache on, the graph would carry
    the trace's length as a constant and fail at any other."""
    from rotary_embedding_torch import RotaryEmbedding

    count = 0
    for module in network.modules():
        if isinstance(module, RotaryEmbedding):
            module.cache_if_possible = False
            module.cached_freqs_seq_len = 0
            count += 1
    if count == 0:
        sys.exit("No rotary embedding found: the model code is not the pinned one.")


def main():
    arguments = parse_arguments()
    sys.path.insert(0, arguments.clearvoice)
    network = load_network(arguments.checkpoint)
    uncache_rotary_embeddings(network)
    model = MaskOnly(network).eval()

    # The trace's values do not reach the graph, only its shape does, and the
    # time axis is dynamic; seeded all the same, so nothing here varies.
    torch.manual_seed(0)
    example = torch.randn(1, 300, 180)
    torch.onnx.export(
        model,
        (example,),
        arguments.output,
        input_names=["fbanks"],
        output_names=["mask"],
        dynamic_axes={"fbanks": {1: "T"}, "mask": {1: "T"}},
        opset_version=17,
        do_constant_folding=False,
        dynamo=False,
    )


if __name__ == "__main__":
    main()
