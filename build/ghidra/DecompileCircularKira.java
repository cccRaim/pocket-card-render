// Decompile the byte-pinned CircularKiraObject methods from a headless Ghidra project.
// @category pocket-card-render

import java.io.BufferedWriter;
import java.io.FileWriter;

import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;

public class DecompileCircularKira extends GhidraScript {
    private static final String[][] TARGETS = {
        { "00442dafc", "00442db34", "CircularKiraObject_UpdateCircularParams" },
        { "00442d9f4", "00442dafc", "CircularKiraObject_UpdateTilt" },
        { "00442db34", "00442debc", "CircularKiraObject_UpdateParticleParams" },
        { "00442debc", "00442e4ec", "CircularKiraObject_UpdateTrailParams" },
        { "00442e4ec", "00442e66c", "CircularKiraObject_ApplyVerticesParams" },
        { "00442e66c", "00442ea38", "CircularKiraObject_ApplyParams" },
        { "00442ea38", "00442ea94", "CircularKiraObject_ResetBrakeParams" },
        { "00442ea94", "00442ebcc", "CircularKiraObject_CalculateBrakeTiming" },
        { "00442d4f8", "00442d574", "CircularKiraObject_LateUpdate" },
        { "00442d100", "00442d4f8", "CircularKiraObject_Initialize" },
        { "00442d574", "00442d9f4", "CircularKiraObject_Validate" },
        { "00442ec8c", "00442ecfc", "CircularKiraObject_Constructor" },
    };

    @Override
    public void run() throws Exception {
        String[] arguments = getScriptArgs();
        if (arguments.length != 1) {
            throw new IllegalArgumentException("expected one output path");
        }

        DecompInterface decompiler = new DecompInterface();
        decompiler.toggleCCode(true);
        decompiler.toggleSyntaxTree(true);
        if (!decompiler.openProgram(currentProgram)) {
            throw new IllegalStateException("failed to initialize decompiler: " + decompiler.getLastMessage());
        }

        try (BufferedWriter output = new BufferedWriter(new FileWriter(arguments[0]))) {
            for (String[] target : TARGETS) {
                Address entry = toAddr(target[0]);
                Address end = toAddr(target[1]).subtract(4);
                AddressSet body = new AddressSet(entry, end);
                Function previous = getFunctionAt(entry);
                if (previous != null) {
                    currentProgram.getFunctionManager().removeFunction(entry);
                }
                DisassembleCommand command = new DisassembleCommand(entry, body, true);
                if (!command.applyTo(currentProgram, monitor)) {
                    throw new IllegalStateException("failed to disassemble " + target[2]);
                }
                Function function = currentProgram.getListing().createFunction(
                    target[2], entry, body, SourceType.USER_DEFINED);
                if (function == null) {
                    throw new IllegalStateException("failed to create function " + target[2]);
                }
                DecompileResults result = decompiler.decompileFunction(function, 30, monitor);
                if (!result.decompileCompleted()) {
                    output.write("\n/* ==== " + target[2] + " @ 0x" + target[0] + " ==== */\n");
                    output.write("/* DECOMPILATION FAILED: " + result.getErrorMessage().replace("*/", "* /") + " */\n");
                    continue;
                }
                output.write("\n/* ==== " + target[2] + " @ 0x" + target[0] + " ==== */\n");
                output.write(result.getDecompiledFunction().getC());
                output.write("\n");
            }
        } finally {
            decompiler.dispose();
        }
    }
}
