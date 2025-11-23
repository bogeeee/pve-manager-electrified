Ext.define('PVE.lxc.MultiMPPanel', {
    extend: 'PVE.panel.MultiDiskPanel',
    alias: 'widget.pveMultiMPPanel',

    onlineHelp: 'pct_container_storage',

    controller: {
        xclass: 'Ext.app.ViewController',

        // count of mps + rootfs
        maxCount: PVE.Utils.lxc_mp_counts.mp + 1,

        getNextFreeDisk: function (vmconfig) {
            let nextFreeDisk;
            if (!vmconfig.rootfs) {
                return {
                    confid: 'rootfs',
                };
            } else {
                for (let i = 0; i < PVE.Utils.lxc_mp_counts.mp; i++) {
                    let confid = `mp${i}`;
                    if (!vmconfig[confid]) {
                        nextFreeDisk = {
                            confid,
                        };
                        break;
                    }
                }
            }
            return nextFreeDisk;
        },

        addPanel: function (itemId, vmconfig, nextFreeDisk) {
            let me = this;
            return me.getView().add({
                vmconfig,
                border: false,
                showAdvanced: Ext.state.Manager.getProvider().get('proxmox-advanced-cb'),
                xtype: 'pveLxcMountPointInputPanel',
                confid: nextFreeDisk.confid === 'rootfs' ? 'rootfs' : null,
                bind: {
                    nodename: '{nodename}',
                    unprivileged: '{unprivileged}',
                },
                padding: '0 5 0 10',
                itemId,
                selectFree: true,
                isCreate: true,
                insideWizard: true,
            });
        },

        getBaseVMConfig: function () {
            let me = this;

            return {
                unprivileged: me.getViewModel().get('unprivileged'),
            };
        },

        diskSorter: {
            sorterFn: function (rec1, rec2) {
                if (rec1.data.name === 'rootfs') {
                    return -1;
                } else if (rec2.data.name === 'rootfs') {
                    return 1;
                }

                let mp_match = /^mp(\d+)$/;
                let [, id1] = mp_match.exec(rec1.data.name);
                let [, id2] = mp_match.exec(rec2.data.name);

                return parseInt(id1, 10) - parseInt(id2, 10);
            },
        },

        deleteDisabled: (view, rI, cI, item, rec) => rec.data.name === 'rootfs',
    },
});
