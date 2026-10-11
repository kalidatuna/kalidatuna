#!/usr/bin/env bash
# ae-linux.sh - run Adobe After Effects (and its plugins) on Linux inside a
# Windows virtual machine, with a real graphics card passed through when the
# hardware allows it.
#
#   ./ae-linux.sh check                    read-only hardware report + recommended path
#   ./ae-linux.sh setup     [--dry-run] [--no-gpu]
#                                          install KVM/libvirt, enable IOMMU, reserve GPU
#   ./ae-linux.sh create-vm [--dry-run] [--no-gpu] [Win11.iso]
#                                          create the Windows VM and start the installer
#   ./ae-linux.sh undo-vfio [--dry-run]    give the reserved GPU back to Linux
#
# Optional overrides (environment variables):
#   AE_GPU=0000:01:00.0   GPU to pass through (default: the one NOT driving your screen)
#   AE_VM_NAME=ae-windows AE_RAM_GB=16 AE_CPUS=8 AE_DISK_GB=200
set -euo pipefail
PATH=$PATH:/usr/local/sbin:/usr/sbin:/sbin

VM_NAME=${AE_VM_NAME:-ae-windows}
IMAGES=/var/lib/libvirt/images
VIRTIO_URL=https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso
VFIO_CONF=/etc/modprobe.d/ae-linux-vfio.conf
DRACUT_CONF=/etc/dracut.conf.d/ae-linux-vfio.conf
MKINITCPIO_CONF=/etc/mkinitcpio.conf.d/ae-linux-vfio.conf
INITRAMFS_TOOLS=/etc/initramfs-tools/modules
MARK_BEGIN='# >>> ae-linux vfio'
MARK_END='# <<< ae-linux vfio'
DRY_RUN=0
REBOOT=

# ---------------------------------------------------------------- output ---
if [ -t 1 ]; then
  B=$'\e[1m' R=$'\e[31m' G=$'\e[32m' Y=$'\e[33m' N=$'\e[0m'
else
  B='' R='' G='' Y='' N=''
fi
info()   { printf '%s\n' "$*"; }
ok()     { printf '%s[ok]%s %s\n' "$G" "$N" "$*"; }
warn()   { printf '%s[!]%s  %s\n' "$Y" "$N" "$*" >&2; }
fail()   { printf '%s[x]%s  %s\n' "$R" "$N" "$*" >&2; }
die()    { fail "$*"; exit 1; }
header() { printf '\n%s== %s ==%s\n' "$B" "$*" "$N"; }

confirm() {
  if [ "$DRY_RUN" = 1 ]; then info "$1 [y/N] (dry run: yes)"; return 0; fi
  local reply
  read -r -p "$1 [y/N] " reply </dev/tty || return 1
  [[ $reply =~ ^[Yy]([Ee][Ss])?$ ]]
}

# Every change to the system goes through these, so --dry-run shows it all.
as_root() {
  if [ "$DRY_RUN" = 1 ]; then printf '   would run: %s\n' "$*"; return 0; fi
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}
write_root() {   # write_root FILE <<< content
  local content; content=$(cat)
  if [ "$DRY_RUN" = 1 ]; then
    printf '   would write %s:\n%s\n' "$1" "$(sed 's/^/     | /' <<<"$content")"; return 0
  fi
  as_root tee "$1" >/dev/null <<<"$content"
}
append_root() {  # append_root FILE <<< content
  local content; content=$(cat)
  if [ "$DRY_RUN" = 1 ]; then
    printf '   would append to %s:\n%s\n' "$1" "$(sed 's/^/     | /' <<<"$content")"; return 0
  fi
  as_root tee -a "$1" >/dev/null <<<"$content"
}
backup_root() {
  if [ -e "$1" ]; then as_root cp -a "$1" "$1.ae-linux-backup.$(date +%Y%m%d-%H%M%S)"; fi
}

# ------------------------------------------------------------- detection ---
distro_name() { ( . /etc/os-release 2>/dev/null; printf '%s' "${PRETTY_NAME:-unknown}" ); }
distro_family() {
  local ids
  ids=$( . /etc/os-release 2>/dev/null; printf ' %s %s ' "${ID:-}" "${ID_LIKE:-}" )
  case $ids in
    *" arch "*) echo arch ;;
    *" debian "*|*" ubuntu "*) echo debian ;;
    *" fedora "*|*" rhel "*) echo fedora ;;
    *" suse "*|*" opensuse "*) echo suse ;;
    *) echo unknown ;;
  esac
}
cpu_vendor() { awk -F': *' '/^vendor_id/{print $2; exit}' /proc/cpuinfo; }
cpu_model()  { awk -F': *' '/^model name/{print $2; exit}' /proc/cpuinfo; }
ram_gb()     { awk '/^MemTotal/{printf "%d", $2/1048576 + 0.5}' /proc/meminfo; }
has_virt()   { grep -Eqw 'vmx|svm' /proc/cpuinfo; }
iommu_on()   { [ -n "$(ls -A /sys/kernel/iommu_groups 2>/dev/null)" ]; }
is_laptop()  {
  case $(cat /sys/class/dmi/id/chassis_type 2>/dev/null) in 8|9|10|14|31|32) return 0 ;; esac
  return 1
}

pci_id()     { local d=/sys/bus/pci/devices/$1; printf '%s:%s' "$(cut -c3- <"$d/vendor")" "$(cut -c3- <"$d/device")"; }
pci_class()  { cat "/sys/bus/pci/devices/$1/class"; }
pci_driver() { local t; if t=$(readlink "/sys/bus/pci/devices/$1/driver" 2>/dev/null); then echo "${t##*/}"; else echo none; fi; }
pci_group()  { local t; if t=$(readlink "/sys/bus/pci/devices/$1/iommu_group" 2>/dev/null); then echo "${t##*/}"; else echo none; fi; }
pci_name() {
  local n; n=$(lspci -s "$1" 2>/dev/null | cut -d' ' -f2- | sed 's/^[^:]*: //' || true)
  echo "${n:-PCI device $(pci_id "$1")}"
}
is_boot_gpu() { [ "$(cat "/sys/bus/pci/devices/$1/boot_vga" 2>/dev/null)" = 1 ]; }

list_gpus() {
  local d
  for d in /sys/bus/pci/devices/*; do
    [ -e "$d/class" ] || continue
    case $(<"$d/class") in 0x0300*|0x0302*|0x0380*) echo "${d##*/}" ;; esac
  done
}

# The GPU to hand to Windows, or nothing. Never the one driving the Linux
# desktop: the firmware must have marked some *other* GPU as boot_vga, so
# when we can't tell which one that is, we pick nothing.
pick_gpu() {
  if [ -n "${AE_GPU:-}" ]; then
    [ -e "/sys/bus/pci/devices/$AE_GPU" ] || die "AE_GPU=$AE_GPU is not a PCI device on this computer."
    echo "$AE_GPU"; return
  fi
  local g boot=0 cand=
  for g in $(list_gpus); do
    if is_boot_gpu "$g"; then boot=1; elif [ -z "$cand" ]; then cand=$g; fi
  done
  if [ "$boot" = 1 ]; then echo "$cand"; fi
}

# Everything that has to go to the VM together with the GPU: the non-bridge
# devices of its IOMMU group (usually its HDMI audio, sometimes USB-C).
passthrough_devices() {
  local gpu=$1 grp d
  grp=$(pci_group "$gpu")
  if [ "$grp" = none ]; then
    for d in /sys/bus/pci/devices/"${gpu%.*}".*; do echo "${d##*/}"; done
    return
  fi
  for d in /sys/kernel/iommu_groups/"$grp"/devices/*; do
    case $(pci_class "${d##*/}") in 0x0604*) continue ;; esac
    echo "${d##*/}"
  done
}

# vfio-pci reserves devices by vendor:device ID, so an ID shared with a device
# we are NOT passing through (two identical GPUs, say) would take that too.
id_collisions() {
  local keep=" $* " ids d id
  ids=$(for d in "$@"; do pci_id "$d"; echo; done | sort -u)
  for d in /sys/bus/pci/devices/*; do
    d=${d##*/}
    [[ $keep == *" $d "* ]] && continue
    id=$(pci_id "$d")
    if grep -qx "$id" <<<"$ids"; then printf '%s (%s) ' "$d" "$id"; fi
  done
}

# Prints why $1 can't be passed through and returns 1, or returns 0.
gpu_problems() {
  local gpu=$1 d bad=0 clash
  if is_boot_gpu "$gpu"; then
    fail "$gpu drives your Linux screen; giving it to Windows would leave Linux with no display."
    return 1
  fi
  if iommu_on; then
    for d in $(passthrough_devices "$gpu"); do
      if [ "${d%.*}" != "${gpu%.*}" ]; then
        warn "IOMMU group $(pci_group "$gpu") also holds $d ($(pci_name "$d")), which isn't part of the card."
        bad=1
      fi
    done
    if [ "$bad" = 1 ]; then
      fail "The card isn't isolated in its own IOMMU group. Try another PCIe slot or a BIOS update." \
           "(The 'ACS override' kernel patch can force it, but it weakens isolation; this script won't.)"
      return 1
    fi
  fi
  # shellcheck disable=SC2046  # PCI addresses never contain spaces
  clash=$(id_collisions $(passthrough_devices "$gpu"))
  if [ -n "$clash" ]; then
    fail "Another device has the same ID as this card (identical GPUs?): $clash"
    fail "Reserving by ID would take both, so this script won't do it."
    return 1
  fi
}

# ----------------------------------------------------------- system edits ---
install_packages() {
  case $1 in
    debian)
      as_root apt-get update
      as_root apt-get install -y qemu-system-x86 qemu-utils libvirt-daemon-system libvirt-clients \
        virtinst virt-manager virt-viewer ovmf swtpm swtpm-tools pciutils curl ;;
    fedora)
      as_root dnf install -y @virtualization virt-viewer swtpm swtpm-tools edk2-ovmf pciutils curl ;;
    arch)
      as_root pacman -S --needed qemu-desktop libvirt virt-install virt-manager virt-viewer \
        edk2-ovmf swtpm dnsmasq pciutils curl ;;
    suse)
      as_root zypper --non-interactive install -t pattern kvm_server kvm_tools
      as_root zypper --non-interactive install virt-manager virt-viewer swtpm qemu-ovmf-x86_64 pciutils curl ;;
  esac
}

start_libvirt() {
  local d
  if systemctl is-active --quiet libvirtd.service || systemctl is-active --quiet virtqemud.socket \
     || systemctl is-active --quiet virtqemud.service; then
    ok "libvirt is running"
  elif systemctl cat virtqemud.socket >/dev/null 2>&1; then
    for d in qemu network storage nodedev secret; do
      if systemctl cat "virt${d}d.socket" >/dev/null 2>&1; then
        as_root systemctl enable --now "virt${d}d.socket"
      fi
    done
  else
    as_root systemctl enable --now libvirtd.service
  fi

  local user=${SUDO_USER:-$(id -un)} grp
  for grp in libvirt kvm; do
    if getent group "$grp" >/dev/null; then as_root usermod -aG "$grp" "$user"; fi
  done

  if ! as_root virsh -c qemu:///system net-info default >/dev/null 2>&1 \
     && [ -f /usr/share/libvirt/networks/default.xml ]; then
    as_root virsh -c qemu:///system net-define /usr/share/libvirt/networks/default.xml || true
  fi
  as_root virsh -c qemu:///system net-autostart default >/dev/null 2>&1 || true
  as_root virsh -c qemu:///system net-start default >/dev/null 2>&1 || true
}

fetch_virtio() {
  if [ -s "$IMAGES/virtio-win.iso" ]; then ok "virtio-win.iso already downloaded"; return; fi
  info "Downloading Windows drivers for virtual disks/network (virtio-win, ~700 MB)..."
  as_root mkdir -p "$IMAGES"
  as_root curl -fL --progress-bar -o "$IMAGES/virtio-win.iso.part" "$VIRTIO_URL"
  as_root mv "$IMAGES/virtio-win.iso.part" "$IMAGES/virtio-win.iso"
}

regen_grub() {
  if command -v update-grub >/dev/null; then as_root update-grub
  elif [ -d /boot/grub2 ]; then as_root grub2-mkconfig -o /boot/grub2/grub.cfg
  else as_root grub-mkconfig -o /boot/grub/grub.cfg
  fi
}

add_kernel_args() {
  local missing=() a
  for a in "$@"; do grep -qw -- "$a" /proc/cmdline || missing+=("$a"); done
  if [ ${#missing[@]} -eq 0 ]; then ok "Kernel already has: $*"; return; fi
  local args="${missing[*]}"
  if command -v kernelstub >/dev/null; then            # Pop!_OS
    for a in "${missing[@]}"; do as_root kernelstub -a "$a"; done
  elif command -v grubby >/dev/null; then              # Fedora / RHEL
    as_root grubby --update-kernel=ALL --args="$args"
  elif [ -f /etc/default/grub ] && grep -q '^GRUB_CMDLINE_LINUX_DEFAULT="' /etc/default/grub; then
    backup_root /etc/default/grub
    as_root sed -i -E "s|^(GRUB_CMDLINE_LINUX_DEFAULT=\"[^\"]*)\"|\1 $args\"|" /etc/default/grub
    regen_grub
  else
    warn "Couldn't recognise your bootloader. Add these kernel parameters yourself, then reboot:"
    info "      $args"
    info "    (systemd-boot: append them to the 'options' line in /boot/loader/entries/*.conf)"
    return
  fi
  ok "Added kernel parameters: $args"
}

initramfs_add_vfio() {
  case $(distro_family) in
    debian)
      if ! grep -qF "$MARK_BEGIN" "$INITRAMFS_TOOLS" 2>/dev/null; then
        backup_root "$INITRAMFS_TOOLS"
        printf '%s\nvfio_pci\nvfio\nvfio_iommu_type1\n%s\n' "$MARK_BEGIN" "$MARK_END" | append_root "$INITRAMFS_TOOLS"
      fi ;;
    fedora|suse)
      write_root "$DRACUT_CONF" <<<'force_drivers+=" vfio_pci vfio vfio_iommu_type1 "' ;;
    arch)
      as_root mkdir -p "${MKINITCPIO_CONF%/*}"
      write_root "$MKINITCPIO_CONF" <<<'MODULES+=(vfio_pci vfio vfio_iommu_type1)' ;;
  esac
}

regen_initramfs() {
  info "Rebuilding the initramfs (takes a minute)..."
  case $(distro_family) in
    debian) as_root update-initramfs -u -k all ;;
    fedora|suse) as_root dracut -f --regenerate-all ;;
    arch) as_root mkinitcpio -P ;;
  esac
}

bind_vfio() {
  local gpu=$1 devs ids d boot
  if [ "$(pci_driver "$gpu")" = vfio-pci ]; then
    ok "$(pci_name "$gpu") is already reserved for the VM"; return
  fi
  devs=$(passthrough_devices "$gpu")
  ids=$(for d in $devs; do pci_id "$d"; echo; done | sort -u | paste -sd, -)
  info "These devices will be reserved for Windows at boot (IDs $ids):"
  for d in $devs; do info "    $d  $(pci_name "$d")"; done
  for d in $(list_gpus); do if is_boot_gpu "$d"; then boot=$d; fi; done
  warn "Linux will stop using this card. Your Linux screen will come from:"
  info "    ${boot:-?}  $(pci_name "${boot:-$gpu}")"
  warn "If your monitor is plugged into the card being reserved, move it to the port of the one above."
  confirm "Reserve these devices for the Windows VM?" || { warn "Skipped. Nothing was changed."; return; }

  write_root "$VFIO_CONF" <<EOF
# Written by ae-linux.sh: reserves the GPU for the Windows VM.
# Undo with: ./ae-linux.sh undo-vfio   (or delete this file and rebuild the initramfs)
options vfio-pci ids=$ids
softdep nvidia pre: vfio-pci
softdep nouveau pre: vfio-pci
softdep amdgpu pre: vfio-pci
softdep radeon pre: vfio-pci
softdep i915 pre: vfio-pci
softdep xe pre: vfio-pci
softdep snd_hda_intel pre: vfio-pci
EOF
  initramfs_add_vfio
  regen_initramfs
  REBOOT=vfio
}

# -------------------------------------------------------------- commands ---
cmd_check() {
  header "This computer"
  info "Linux:    $(distro_name)  (family: $(distro_family))"
  info "CPU:      $(cpu_model), $(nproc) threads"
  info "RAM:      $(ram_gb) GB"
  info "Type:     $(is_laptop && echo laptop || echo desktop)"

  header "Virtualization"
  local ready=1
  if has_virt; then ok "CPU supports hardware virtualization"
  else fail "Hardware virtualization is off. Enable Intel VT-x / AMD SVM ('Virtualization Technology') in the BIOS."; ready=0
  fi
  if [ -e /dev/kvm ]; then ok "/dev/kvm is available"
  else warn "/dev/kvm is missing ('setup' installs KVM; if it stays missing, virtualization is off in the BIOS)"
  fi
  if iommu_on; then ok "IOMMU is on ($(ls /sys/kernel/iommu_groups | wc -l) groups)"
  else warn "IOMMU is off. Only GPU passthrough needs it; 'setup' turns it on."
  fi
  if [ "$(ram_gb)" -lt 24 ]; then
    warn "$(ram_gb) GB RAM: After Effects wants 16 GB inside the VM, so expect it to be tight."
  fi

  header "Graphics cards"
  local g n=0
  for g in $(list_gpus); do
    n=$((n + 1))
    info "  $g  [$(pci_id "$g")]  $(pci_name "$g")"
    info "      driver: $(pci_driver "$g"), IOMMU group: $(pci_group "$g")$(is_boot_gpu "$g" && echo ', drives your Linux screen')"
  done
  [ "$n" -gt 0 ] || warn "No graphics cards found."

  header "Recommendation"
  if [ "$ready" = 0 ]; then fail "Turn on virtualization in the BIOS first, then run: $0 check"; return; fi
  local gpu; gpu=$(pick_gpu)
  if is_laptop; then
    info "Path B: Windows VM with virtual graphics. Laptop GPUs can rarely be passed through."
    info "After Effects and most plugins run; GPU-accelerated effects and GPU-only plugins will be"
    info "slow or unavailable. If you need those at full speed on this laptop, dual-boot Windows."
  elif [ -n "$gpu" ] && gpu_problems "$gpu"; then
    ok "Path A: Windows VM with $(pci_name "$gpu") passed through."
    info "Windows gets the real card, so After Effects, GPU acceleration and GPU plugins run at"
    info "near-native speed. Plug a monitor (or an HDMI dummy plug) into that card for the VM."
  else
    info "Path B: Windows VM with virtual graphics (no GPU can be safely given to Windows)."
    info "After Effects and most plugins run; GPU-heavy effects/plugins will be slow or unavailable."
    if [ "$n" -ge 2 ] && [ -z "$gpu" ]; then
      info "You have $n GPUs, but the firmware doesn't say which one drives your screen, so the"
      info "script won't guess. Pick the one for Windows yourself, e.g.:  AE_GPU=0000:01:00.0 $0 check"
    else
      info "For Path A you need a second GPU for Linux: enable your CPU's integrated graphics in the"
      info "BIOS and plug the monitor into the motherboard, or add any cheap second card. Re-run check."
    fi
  fi
  info ""
  info "Next: $0 setup     (you'll also need a Windows 10/11 ISO and licence for the VM)"
}

cmd_setup() {
  local passthrough=1 a
  for a in "$@"; do
    case $a in --dry-run) DRY_RUN=1 ;; --no-gpu) passthrough=0 ;; *) die "Unknown option: $a" ;; esac
  done
  has_virt || die "Hardware virtualization is off. Enable Intel VT-x / AMD SVM in the BIOS, then re-run."
  local fam; fam=$(distro_family)
  [ "$fam" != unknown ] || die "Unsupported distro ($(distro_name)). Supported: Ubuntu/Debian/Mint/Pop!_OS, Fedora, Arch/Manjaro, openSUSE."
  [ "$DRY_RUN" = 1 ] && warn "Dry run: nothing will be changed."

  header "1/5 Installing QEMU/KVM, libvirt and virt-manager"
  install_packages "$fam"

  header "2/5 Starting libvirt"
  start_libvirt

  header "3/5 Windows drivers for the VM"
  fetch_virtio

  local gpu=
  if [ "$passthrough" = 1 ] && ! is_laptop; then gpu=$(pick_gpu); fi
  if [ -z "$gpu" ]; then
    header "4/5 + 5/5 GPU passthrough: skipped"
    info "No second GPU to give Windows (see '$0 check'). The VM will use virtual graphics."
    [ -n "$REBOOT" ] || REBOOT=relogin
    return
  fi

  header "4/5 IOMMU"
  local want=(iommu=pt) a need=0
  [ "$(cpu_vendor)" != GenuineIntel ] || want=(intel_iommu=on iommu=pt)
  for a in "${want[@]}"; do grep -qw -- "$a" /proc/cmdline || need=1; done
  if iommu_on; then
    ok "IOMMU is on"
  elif [ "$need" = 0 ]; then
    fail "The IOMMU is still off even though the kernel has '${want[*]}'."
    fail "Enable 'VT-d' (Intel) or 'IOMMU' / 'AMD-Vi' (AMD) in the BIOS, then run '$0 setup' again."
    REBOOT=relogin
    return
  else
    add_kernel_args "${want[@]}"
    warn "Also make sure 'VT-d' (Intel) or 'IOMMU' / 'AMD-Vi' (AMD) is enabled in the BIOS."
    REBOOT=iommu
    return
  fi

  header "5/5 Reserve $(pci_name "$gpu") for Windows"
  if gpu_problems "$gpu"; then
    bind_vfio "$gpu"
  else
    warn "Skipping GPU passthrough; the VM will use virtual graphics."
  fi
  [ -n "$REBOOT" ] || REBOOT=relogin
}

cmd_undo_vfio() {
  local a
  for a in "$@"; do case $a in --dry-run) DRY_RUN=1 ;; *) die "Unknown option: $a" ;; esac; done
  as_root rm -f "$VFIO_CONF" "$DRACUT_CONF" "$MKINITCPIO_CONF"
  if grep -qF "$MARK_BEGIN" "$INITRAMFS_TOOLS" 2>/dev/null; then
    as_root sed -i "/^$MARK_BEGIN\$/,/^$MARK_END\$/d" "$INITRAMFS_TOOLS"
  fi
  regen_initramfs
  ok "Done. After a reboot Linux uses the GPU again."
  warn "If the VM still lists the card, remove it in virt-manager (Show hardware details > PCI device)."
}

cmd_create_vm() {
  local iso='' use_gpu=1 a
  for a in "$@"; do
    case $a in --dry-run) DRY_RUN=1 ;; --no-gpu) use_gpu=0 ;; -*) die "Unknown option: $a" ;; *) iso=$a ;; esac
  done
  command -v virt-install >/dev/null || die "virt-install not found. Run '$0 setup' first."
  [ -e /dev/kvm ] || die "/dev/kvm is missing. Enable virtualization in the BIOS and run '$0 setup'."
  if [ "$(id -u)" -ne 0 ] && [[ " $(id -nG) " != *" libvirt "* ]]; then
    die "You aren't in the 'libvirt' group yet. Log out and back in (or reboot) after '$0 setup'."
  fi
  if virsh -c qemu:///system dominfo "$VM_NAME" >/dev/null 2>&1; then
    die "A VM called '$VM_NAME' already exists. Open 'Virtual Machine Manager' to use it, or set AE_VM_NAME."
  fi

  if [ -z "$iso" ]; then
    iso=$(ls -t "$HOME"/Downloads/[Ww]in*.iso 2>/dev/null | head -n1 || true)
  fi
  if [ -z "$iso" ] || [ ! -f "$iso" ]; then
    die "Download the Windows 11 ISO from https://www.microsoft.com/software-download/windows11" \
        "then run: $0 create-vm /path/to/Win11.iso"
  fi
  case $(readlink -f "$iso") in
    "$IMAGES"/*) ;;
    *) # libvirt's QEMU user usually can't read files in your home folder.
       info "Copying $(basename "$iso") into $IMAGES so the VM can read it..."
       if [ "$DRY_RUN" = 1 ] || [ ! -f "$IMAGES/$(basename "$iso")" ]; then as_root cp "$iso" "$IMAGES/"; fi
       iso=$IMAGES/$(basename "$iso") ;;
  esac
  [ -s "$IMAGES/virtio-win.iso" ] || fetch_virtio

  local total reserve ram cpus disk threads
  total=$(ram_gb)
  reserve=$(( total / 4 > 4 ? total / 4 : 4 ))
  ram=${AE_RAM_GB:-$(( total - reserve ))}
  [ "$ram" -ge 4 ] || ram=4
  threads=$(nproc)
  cpus=${AE_CPUS:-$(( threads > 4 ? threads - 2 : 2 ))}
  disk=${AE_DISK_GB:-200}
  # virt-install refuses a disk bigger than the free space, even though the file grows lazily.
  local avail
  avail=$(df -BG --output=avail "$IMAGES" 2>/dev/null | tail -n1 | tr -dc 0-9 || true)
  if [ -n "$avail" ]; then
    [ "$avail" -ge 80 ] || die "Only ${avail} GB free in $IMAGES; Windows + After Effects need at least 80 GB."
    if [ "$disk" -gt $(( avail - 10 )) ]; then
      disk=$(( avail - 10 ))
      warn "Only ${avail} GB free, so the VM disk will be ${disk} GB."
    fi
  fi
  [ "$ram" -ge 16 ] || warn "The VM gets ${ram} GB RAM; After Effects recommends 16 GB or more."

  local hostdevs=() gpu='' d
  if [ "$use_gpu" = 1 ] && ! is_laptop; then gpu=$(pick_gpu); fi
  if [ -n "$gpu" ] && [ "$(pci_driver "$gpu")" = vfio-pci ]; then
    for d in $(passthrough_devices "$gpu"); do hostdevs+=(--hostdev "pci_$(tr ':.' '__' <<<"$d")"); done
    ok "Passing $(pci_name "$gpu") through to Windows"
  elif [ -n "$gpu" ]; then
    warn "$(pci_name "$gpu") isn't reserved yet (driver: $(pci_driver "$gpu")), so the VM gets virtual graphics."
    warn "To add the card later: '$0 setup', reboot, then in virt-manager add it as a PCI host device."
  fi

  local variant=win11 known
  known=$(virt-install --os-variant list 2>/dev/null || true)
  grep -qw win11 <<<"$known" || variant=win10

  # shellcheck disable=SC2054  # the commas belong to virt-install's option syntax
  local args=(
    --connect qemu:///system
    --name "$VM_NAME"
    --os-variant "$variant"
    --memory $(( ram * 1024 ))
    --vcpus "$cpus,sockets=1,cores=$cpus,threads=1"
    --cpu host-passthrough
    --boot firmware=efi,firmware.feature0.name=secure-boot,firmware.feature0.enabled=yes,firmware.feature1.name=enrolled-keys,firmware.feature1.enabled=yes
    --tpm backend.type=emulator,backend.version=2.0,model=tpm-crb
    --disk "path=$IMAGES/$VM_NAME.qcow2,size=$disk,format=qcow2,bus=virtio,discard=unmap"
    --cdrom "$iso"
    --disk "path=$IMAGES/virtio-win.iso,device=cdrom"
    --network network=default,model=e1000e
    --graphics spice
    --video qxl
    --sound ich9
    ${hostdevs[@]+"${hostdevs[@]}"}
  )

  header "Creating '$VM_NAME': ${ram} GB RAM, ${cpus} CPUs, ${disk} GB disk (grows as used)"
  cat <<EOF
A window with the Windows installer opens next. In it:

  1. Click into the window and press any key at "Press any key to boot from CD or DVD".
     Missed it? Type 'exit' in the UEFI shell, open Boot Manager and pick the DVD drive.
  2. At "Where do you want to install Windows?" the list is empty. Click "Load driver",
     "Browse", open the virtio-win CD, pick viostor > w11 (or w10) > amd64, then OK.
     The ${disk} GB disk appears; select it and continue.
  3. Finish Windows setup ("I don't have a product key" lets you activate later).
  4. In Windows, open the virtio-win CD and run virtio-win-guest-tools.exe.
EOF
  if [ ${#hostdevs[@]} -gt 0 ]; then
    cat <<EOF
  5. Plug a monitor (or an HDMI dummy plug) into $(pci_name "$gpu")
     and install its normal NVIDIA/AMD/Intel driver inside Windows.
  6. Install Creative Cloud, After Effects and your plugins as usual.
EOF
  else
    info "  5. Install Creative Cloud, After Effects and your plugins as usual."
  fi
  info ""
  info "Later: start the VM from 'Virtual Machine Manager' (virt-manager)."
  info ""

  if [ "$DRY_RUN" = 1 ]; then
    info "Dry run, would run:"; printf '   virt-install'; printf ' %s' "${args[@]}"; echo
    return
  fi
  read -r -p "Press Enter to start the installer..." _ </dev/tty || true
  virt-install "${args[@]}"
}

usage() { sed -n '2,17s/^# \{0,1\}//p' "$0"; }

main() {
  [ "$(uname -s)" = Linux ] || die "Run this on your Linux computer."
  local cmd=${1:-help}
  shift || true
  case $cmd in
    check) cmd_check ;;
    setup) cmd_setup "$@" ;;
    create-vm) cmd_create_vm "$@" ;;
    undo-vfio) cmd_undo_vfio "$@"; REBOOT=undo ;;
    *) usage; return ;;
  esac

  case $REBOOT in
    iommu) header "Reboot needed"
           info "Reboot, then run '$0 setup' again: it continues with reserving the GPU." ;;
    vfio)  header "Reboot needed"
           info "Reboot (monitor on the Linux GPU's port), then run: $0 create-vm /path/to/Win11.iso" ;;
    relogin) header "Almost there"
           info "Log out and back in (so your new 'libvirt' group applies), then run:"
           info "    $0 create-vm /path/to/Win11.iso" ;;
    undo)  info "Reboot to finish." ;;
  esac
}

main "$@"
