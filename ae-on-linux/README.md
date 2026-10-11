# After Effects on Linux

`ae-linux.sh` sets up a Windows virtual machine on your Linux computer to run Adobe After Effects and its plugins. If you have a second graphics card, the script reserves it for Windows. After Effects then gets the real card, so GPU acceleration and GPU plugins run at near-native speed.

After Effects doesn't run on Linux directly. Adobe only ships Windows and macOS builds, and Wine can't get recent Creative Cloud versions working. A VM is the setup that does work.

## Quick start

```bash
chmod +x ae-linux.sh
./ae-linux.sh check                 # read-only: what your hardware supports
./ae-linux.sh setup --dry-run       # preview every change, without changing anything
./ae-linux.sh setup                 # do it (asks for your password via sudo)
# reboot or log out/in when told to, run setup again if it says so, then:
./ae-linux.sh create-vm ~/Downloads/Win11_*.iso
```

You also need the Windows 11 ISO from <https://www.microsoft.com/software-download/windows11> and a Windows licence. You can activate Windows later.

## The two paths

| Your hardware | What you get |
| --- | --- |
| **Desktop with two GPUs** (for example integrated graphics + an NVIDIA/AMD card) | **Path A:** Windows gets the dedicated card. After Effects and GPU plugins run at near-native speed. Connect a monitor or an HDMI dummy plug to that card. |
| **One GPU, or a laptop** | **Path B:** Windows uses virtual graphics. After Effects and CPU plugins work. GPU-accelerated effects and GPU-only plugins are slow or unavailable. |

On a desktop with only one GPU, you can still get Path A. Enable your CPU's integrated graphics in the BIOS and connect the monitor to the motherboard, or add any cheap second card. Then run `check` again.

## What `setup` changes

- Installs QEMU/KVM, libvirt, virt-manager, OVMF (UEFI firmware) and swtpm (a virtual TPM, which Windows 11 needs). Supports Ubuntu/Debian/Mint/Pop!_OS, Fedora, Arch/Manjaro and openSUSE.
- Adds you to the `libvirt` group and downloads the virtio-win driver ISO.
- **Path A only:**
  - Adds `intel_iommu=on iommu=pt` (Intel) or `iommu=pt` (AMD) to the kernel command line. Before editing `/etc/default/grub`, it saves a backup next to it.
  - Writes `/etc/modprobe.d/ae-linux-vfio.conf` so the card is reserved for the VM at boot.
  - Rebuilds the initramfs.

The script refuses to reserve a GPU in these cases:

- It's the GPU your Linux screen uses.
- It shares an IOMMU group with unrelated devices.
- Another device has the same hardware ID, for example two identical cards.
- The firmware doesn't report which GPU drives your screen. In that case, choose one with `AE_GPU=0000:01:00.0`.

To give the card back to Linux, run `./ae-linux.sh undo-vfio` and reboot.

## Notes

- Enable virtualization in your BIOS: Intel VT-x / AMD SVM. For Path A, also enable VT-d / IOMMU.
- The VM gets about ¾ of your RAM, all CPU threads but two, and a 200 GB disk that grows as it's used. If you have less free space, the disk is made smaller to fit. Override these with `AE_RAM_GB`, `AE_CPUS` and `AE_DISK_GB`.
- After setup, start the VM from **Virtual Machine Manager**.
- The scripts were tested against simulated hardware, not a physical GPU passthrough machine. Run `setup --dry-run` first and read what it plans to do.
