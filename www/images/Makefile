include ../../defines.mk

all:

# virt-viewer.svg copied from virt-viewer source (and reformatted):
# https://github.com/webrulon/virt-viewer/blob/master/icons/virt-viewer.svg
#
# novnc.svg copied from the noVnc source:
# https://github.com/novnc/noVNC/blob/master/app/images/icons/novnc-icon-sm.svg

# icon-cd-drive and icon-pci
# are self made (sources as .xcf)
# icon-cloud
# come from fontawesome (respective fa-cloud)

# icon-serial is a modified version of
# https://commons.wikimedia.org/wiki/File:DE9_Diagram.svg
# (public domain)

# logo-ceph is adapted and reformatted from Ceph_Logo.svg:
# https://github.com/ceph/ceph/blob/main/src/pybind/mgr/dashboard/frontend/src/assets/Ceph_Logo.svg

# xtermjs.svg was copied from the xtermjs-branding sources:
# https://github.com/xtermjs/xtermjs-branding/blob/master/logo.svg

IMAGES =			\
	virt-viewer.svg		\
	novnc.svg		\
	xtermjs.svg		\
	favicon.ico		\
	proxmox_logo.png	\
	pve-electrified_logo.png \
    pve-electrified_logo_30x172.png \
	logo-ceph.svg		\
	logo-128.png		\
	icon-serial.svg		\
	icon-cloud.svg		\
	icon-pci.svg		\
	icon-die.svg		\
	icon-sdn.svg		\
	icon-fa-network-wired.svg\
	icon-cpu.svg		\
	icon-memory.svg		\
	icon-cd-drive.svg	\
	spinner.svg		\

icon-sdn.svg: icon-sdn.dot
	fdp -Tsvg $< > $@

.PHONY: install
install: $(IMAGES)
	install -d $(WWWIMAGEDIR)
	install -m 0644 $(IMAGES) $(WWWIMAGEDIR)

.PHONY: clean
clean:
	rm -rf *~
