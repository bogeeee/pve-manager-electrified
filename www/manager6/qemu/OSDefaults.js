/*
 * This class holds performance *recommended* settings for the PVE Qemu wizards
 * the *mandatory* settings are set in the PVE::QemuServer
 * config_to_command sub
 * We store this here until we get the data from the API server
 */

// this is how you would add an hypothetic FreeBSD > 10 entry
//
//virtio-blk is stable but virtIO net still
//   problematic as of 10.3
// see https://bugs.freebsd.org/bugzilla/show_bug.cgi?id=165059
//	addOS({
//	    parent: 'generic', // inherits defaults
//	    pveOS: 'freebsd10', // must match a radiofield in OSTypeEdit.js
//	    busType: 'virtio' // must match a pveBusController value
//			    // networkCard muss match a pveNetworkCardSelector

Ext.define('PVE.qemu.OSDefaults', {
    singleton: true, // will also force creation when loaded

    constructor: function () {
        let me = this;

        let addOS = function (settings) {
            if (Object.hasOwn(settings, 'parent')) {
                let architectures = settings.architectures;
                delete settings.architectures;

                let child = {
                    x86_64: Ext.apply({}, settings, me[settings.parent].x86_64),
                };

                for (const arch of Object.keys(architectures ?? {})) {
                    child[arch] = Ext.apply({}, architectures[arch], me[settings.parent][arch]);
                }
                me[settings.pveOS] = child;
            } else {
                throw 'Could not find your genitor';
            }
        };

        // default values
        me.generic = {
            x86_64: {
                busType: 'ide',
                networkCard: 'e1000',
                busPriority: {
                    ide: 4,
                    sata: 3,
                    scsi: 2,
                    virtio: 1,
                },
                scsihw: 'virtio-scsi-single',
            },

            aarch64: {
                // aarch64 has no ide, and ovmf can't boot from sata
                busType: 'scsi',
                networkCard: 'e1000',
                busPriority: {
                    scsi: 4,
                    sata: 3,
                    virtio: 2,
                    ide: 1,
                },
                scsihw: 'virtio-scsi-single',
                cputype: 'neoverse-n2',
                bios: 'ovmf',
            },
        };

        // virtio-net is in kernel since 2.6.25
        // virtio-scsi since 3.2 but backported in RHEL with 2.6 kernel
        addOS({
            pveOS: 'l26',
            parent: 'generic',
            busType: 'scsi',
            busPriority: {
                scsi: 4,
                virtio: 3,
                sata: 2,
                ide: 1,
            },
            networkCard: 'virtio',

            architectures: {
                aarch64: {
                    busPriority: {
                        scsi: 4,
                        virtio: 2,
                        sata: 2,
                        ide: 1,
                    },
                    networkCard: 'virtio',
                },
            },
        });

        // recommendation from http://wiki.qemu.org/Windows2000
        addOS({
            pveOS: 'w2k',
            parent: 'generic',
            networkCard: 'rtl8139',
            scsihw: '',
        });
        // https://pve.proxmox.com/wiki/Windows_XP_Guest_Notes
        addOS({
            pveOS: 'wxp',
            parent: 'w2k',
        });

        addOS({
            pveOS: 'win11',
            parent: 'generic',
            machine: 'q35',
            bios: 'ovmf',
        });

        me.getDefaults = function (ostype, arch = 'x86_64') {
            if (!PVE.qemu.OSDefaults[ostype]) {
                ostype = 'generic';
            }

            let os = PVE.qemu.OSDefaults[ostype];
            if (os[arch]) {
                return os[arch];
            }

            // default
            return os.x86_64;
        };
    },
});
