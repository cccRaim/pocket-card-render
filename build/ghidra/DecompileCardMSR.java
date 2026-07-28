// Decompile the byte-pinned CardMSRObject methods from the official ARM64 libil2cpp.
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

public class DecompileCardMSR extends GhidraScript {
    private static final String[][] TARGETS = {
        { "0442675c", "044267ac", "CardMSRObject_Awake" },
        { "044267ac", "04426b90", "CardMSRObject_Validate" },
        { "04426b90", "04426bc4", "CardMSRObject_Initialize" },
        { "04426bc4", "04426c0c", "CardMSRObject_LateUpdate" },
        { "04426c0c", "04426ca8", "CardMSRObject_EvaluateAnim" },
        { "04426ca8", "04426ee8", "CardMSRObject_UpdateTilt" },
        { "04426ee8", "04426fbc", "CardMSRObject_UpdateTranslateLayer" },
        { "04426fbc", "04427088", "CardMSRObject_UpdateAnimation" },
        { "04427088", "0442733c", "CardMSRObject_UpdateReflection" },
        { "0442733c", "044276d8", "CardMSRObject_ApplyParams" },
        { "044276d8", "044277b0", "CardMSRObject_Constructor" },
        { "044277b0", "0442796c", "CardMSRObject_StaticConstructor" },
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
            throw new IllegalStateException(
                "failed to initialize decompiler: " + decompiler.getLastMessage());
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
                output.write("\n/* ==== " + target[2] + " @ 0x" + target[0] + " ==== */\n");
                if (!result.decompileCompleted()) {
                    output.write(
                        "/* DECOMPILATION FAILED: "
                            + result.getErrorMessage().replace("*/", "* /")
                            + " */\n");
                    continue;
                }
                output.write(result.getDecompiledFunction().getC());
                output.write("\n");
            }
        } finally {
            decompiler.dispose();
        }
    }
}
