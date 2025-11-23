include ../defines.mk

all:

.PHONY: install
install: vzdump.conf pve-sources.sources pve-initramfs.conf pve-blacklist.conf pve.logrotate virtual-function-pinning.rules virtual-function-pinning-helper
	install -D -m 0644 pve.logrotate $(DESTDIR)/etc/logrotate.d/pve
	install -D -m 0644 pve-sources.sources $(DESTDIR)/etc/apt/sources.list.d/pve-enterprise.sources
	install -D -m 0644 pve-blacklist.conf $(DESTDIR)/etc/modprobe.d/pve-blacklist.conf
	install -D -m 0644 vzdump.conf $(DESTDIR)/etc/vzdump.conf
	install -D -m 0644 pve-initramfs.conf $(DESTDIR)/etc/initramfs-tools/conf.d/pve-initramfs.conf
	install -D -m 0644 proxmox-ve-default.link $(DESTDIR)/usr/lib/systemd/network/99-default.link.d/proxmox-mac-address-policy.conf
	install -D -m 0644 virtual-function-pinning.rules $(DESTDIR)/usr/lib/udev/rules.d/70-virtual-function-pinning.rules
	install -D -m 0755 virtual-function-pinning-helper $(DESTDIR)/usr/lib/udev/virtual-function-naming-helper

clean:
