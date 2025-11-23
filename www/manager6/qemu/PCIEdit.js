Ext.define('PVE.qemu.PCIInputPanel', {
    extend: 'Proxmox.panel.InputPanel',

    onlineHelp: 'qm_pci_passthrough_vm_config',

    controller: {
        xclass: 'Ext.app.ViewController',

        setVMConfig: function (vmconfig) {
            let me = this;
            let view = me.getView();
            let vm = me.getViewModel();
            me.vmconfig = vmconfig;

            let hostpci = me.vmconfig[view.confid] || '';

            let values = PVE.Parser.parsePropertyString(hostpci, 'host');
            if (values.host) {
                if (!values.host.match(/^[0-9a-f]{4}:/i)) {
                    // add optional domain
                    values.host = '0000:' + values.host;
                }
                if (values.host.length < 11) {
                    // 0000:00:00 format not 0000:00:00.0
                    values.host += '.0';
                    values.multifunction = true;
                }
                values.type = 'raw';
            } else if (values.mapping) {
                values.type = 'mapped';
            }
            vm.set('isMapped', values.type !== 'raw');

            values['x-vga'] = PVE.Parser.parseBoolean(values['x-vga'], 0);
            values.pcie = PVE.Parser.parseBoolean(values.pcie, 0);
            values.rombar = PVE.Parser.parseBoolean(values.rombar, 1);

            view.setValues(values);
            if (!me.vmconfig.machine || me.vmconfig.machine.indexOf('q35') === -1) {
                // machine is not set to some variant of q35, so we disable pcie
                let pcie = me.lookup('pcie');
                pcie.setDisabled(true);
                pcie.setBoxLabel(gettext('Q35 only'));
            }

            if (values.romfile) {
                me.lookup('romfile').setVisible(true);
            }
        },

        selectorEnable: function (selector) {
            let me = this;
            me.pciDevChange(selector, selector.getValue());
        },

        pciDevChange: function (pcisel, value) {
            let me = this;
            let mdevfield = me.lookup('mdev');
            if (!value) {
                if (!pcisel.isDisabled()) {
                    mdevfield.setDisabled(true);
                }
                return;
            }
            let pciDev = pcisel.getStore().getById(value);

            mdevfield.setDisabled(!pciDev || !pciDev.data.mdev);
            if (!pciDev) {
                return;
            }

            let path = value;
            if (pciDev.data.map) {
                path = pciDev.data.id;
            }

            if (pciDev.data.mdev) {
                mdevfield.setPciIdOrMapping(path);
            }
            if (pcisel.reference === 'selector') {
                let iommu = pciDev.data.iommugroup;
                if (iommu === -1) {
                    return;
                }
                // try to find out if there are more devices in that iommu group
                let id = path.substring(0, 5); // 00:00
                let count = 0;
                pcisel.getStore().each(({ data }) => {
                    if (data.iommugroup === iommu && data.id.substring(0, 5) !== id) {
                        count++;
                        return false;
                    }
                    return true;
                });
                me.lookup('group_warning').setVisible(count > 0);
            }
        },

        onGetValues: function (values) {
            let me = this;
            let view = me.getView();
            if (!view.confid) {
                for (let i = 0; i < PVE.Utils.hardware_counts.hostpci; i++) {
                    if (!me.vmconfig['hostpci' + i.toString()]) {
                        view.confid = 'hostpci' + i.toString();
                        break;
                    }
                }
                // FIXME: what if no confid was found??
            }

            values.host?.replace(/^0000:/, ''); // remove optional '0000' domain

            if (values.multifunction && values.host) {
                values.host = values.host.substring(0, values.host.indexOf('.')); // skip the '.X'
                delete values.multifunction;
            }

            if (values.rombar) {
                delete values.rombar;
            } else {
                values.rombar = 0;
            }

            if (!values.romfile) {
                delete values.romfile;
            }

            delete values.type;

            let ret = {};
            ret[view.confid] = PVE.Parser.printPropertyString(values, 'host');
            return ret;
        },
    },

    viewModel: {
        data: {
            isMapped: true,
        },
    },

    setVMConfig: function (vmconfig) {
        return this.getController().setVMConfig(vmconfig);
    },

    onGetValues: function (values) {
        return this.getController().onGetValues(values);
    },

    initComponent: function () {
        let me = this;

        me.nodename = me.pveSelNode.data.node;
        if (!me.nodename) {
            throw 'no node name specified';
        }

        me.columnT = [
            {
                xtype: 'displayfield',
                reference: 'iommu_warning',
                hidden: true,
                columnWidth: 1,
                padding: '0 0 10 0',
                value:
                    'No IOMMU detected, please activate it.' +
                    'See Documentation for further information.',
                userCls: 'pmx-hint',
            },
            {
                xtype: 'displayfield',
                reference: 'group_warning',
                hidden: true,
                columnWidth: 1,
                padding: '0 0 10 0',
                itemId: 'iommuwarning',
                value: 'The selected Device is not in a separate IOMMU group, make sure this is intended.',
                userCls: 'pmx-hint',
            },
        ];

        me.column1 = [
            {
                xtype: 'radiofield',
                name: 'type',
                inputValue: 'mapped',
                checked: true,
                boxLabel: gettext('Mapped Device'),
                bind: {
                    value: '{isMapped}',
                },
            },
            {
                xtype: 'pvePCIMapSelector',
                fieldLabel: gettext('Device'),
                reference: 'mapped_selector',
                name: 'mapping',
                labelAlign: 'right',
                nodename: me.nodename,
                allowBlank: false,
                bind: {
                    disabled: '{!isMapped}',
                },
                listeners: {
                    change: 'pciDevChange',
                    enable: 'selectorEnable',
                },
            },
            {
                xtype: 'radiofield',
                name: 'type',
                inputValue: 'raw',
                boxLabel: gettext('Raw Device'),
            },
            {
                xtype: 'pvePCISelector',
                fieldLabel: gettext('Device'),
                name: 'host',
                reference: 'selector',
                nodename: me.nodename,
                labelAlign: 'right',
                allowBlank: false,
                disabled: true,
                bind: {
                    disabled: '{isMapped}',
                },
                onLoadCallBack: function (store, records, success) {
                    if (!success || !records.length) {
                        return;
                    }
                    me.lookup('iommu_warning').setVisible(
                        records.every((val) => val.data.iommugroup === -1),
                    );
                },
                listeners: {
                    change: 'pciDevChange',
                    enable: 'selectorEnable',
                },
            },
            {
                xtype: 'proxmoxcheckbox',
                fieldLabel: gettext('All Functions'),
                reference: 'all_functions',
                disabled: true,
                labelAlign: 'right',
                name: 'multifunction',
                bind: {
                    disabled: '{isMapped}',
                },
            },
        ];

        me.column2 = [
            {
                xtype: 'pveMDevSelector',
                name: 'mdev',
                reference: 'mdev',
                disabled: true,
                fieldLabel: gettext('MDev Type'),
                nodename: me.nodename,
                listeners: {
                    change: function (field, value) {
                        let multiFunction = me.down('field[name=multifunction]');
                        if (value) {
                            multiFunction.setValue(false);
                        }
                        multiFunction.setDisabled(!!value);
                    },
                },
            },
            {
                xtype: 'proxmoxcheckbox',
                fieldLabel: gettext('Primary GPU'),
                name: 'x-vga',
            },
        ];

        me.advancedColumn1 = [
            {
                xtype: 'proxmoxcheckbox',
                fieldLabel: 'ROM-Bar',
                name: 'rombar',
            },
            {
                xtype: 'displayfield',
                submitValue: true,
                hidden: true,
                fieldLabel: 'ROM-File',
                reference: 'romfile',
                name: 'romfile',
            },
            {
                xtype: 'textfield',
                name: 'vendor-id',
                fieldLabel: gettext('Vendor ID'),
                emptyText: gettext('From Device'),
                vtype: 'PciId',
                allowBlank: true,
                submitEmpty: false,
            },
            {
                xtype: 'textfield',
                name: 'device-id',
                fieldLabel: gettext('Device ID'),
                emptyText: gettext('From Device'),
                vtype: 'PciId',
                allowBlank: true,
                submitEmpty: false,
            },
        ];

        me.advancedColumn2 = [
            {
                xtype: 'proxmoxcheckbox',
                fieldLabel: 'PCI-Express',
                reference: 'pcie',
                name: 'pcie',
            },
            {
                xtype: 'textfield',
                name: 'sub-vendor-id',
                fieldLabel: gettext('Sub-Vendor ID'),
                emptyText: gettext('From Device'),
                vtype: 'PciId',
                allowBlank: true,
                submitEmpty: false,
            },
            {
                xtype: 'textfield',
                name: 'sub-device-id',
                fieldLabel: gettext('Sub-Device ID'),
                emptyText: gettext('From Device'),
                vtype: 'PciId',
                allowBlank: true,
                submitEmpty: false,
            },
        ];

        me.callParent();
    },
});

Ext.define('PVE.qemu.PCIEdit', {
    extend: 'Proxmox.window.Edit',

    subject: gettext('PCI Device'),

    vmconfig: undefined,
    isAdd: true,

    initComponent: function () {
        let me = this;

        me.isCreate = !me.confid;

        let ipanel = Ext.create('PVE.qemu.PCIInputPanel', {
            confid: me.confid,
            pveSelNode: me.pveSelNode,
        });

        Ext.apply(me, {
            items: [ipanel],
        });

        me.callParent();

        me.load({
            success: ({ result }) => ipanel.setVMConfig(result.data),
        });
    },
});
