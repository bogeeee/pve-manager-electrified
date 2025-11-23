Ext.define('PVE.window.GuestDiskReassign', {
    extend: 'Proxmox.window.Edit',
    mixins: ['Proxmox.Mixin.CBind'],

    resizable: false,
    modal: true,
    width: 350,
    border: false,
    layout: 'fit',
    showReset: false,
    showProgress: true,
    method: 'POST',

    viewModel: {
        data: {
            mpType: '',
        },
        formulas: {
            mpMaxCount: (get) =>
                get('mpType') === 'mp'
                    ? PVE.Utils.lxc_mp_counts.mps - 1
                    : PVE.Utils.lxc_mp_counts.unused - 1,
        },
    },

    cbindData: function () {
        let me = this;
        return {
            vmid: me.vmid,
            disk: me.disk,
            isQemu: me.type === 'qemu',
            nodename: me.nodename,
            url: () => {
                let endpoint = me.type === 'qemu' ? 'move_disk' : 'move_volume';
                return `/nodes/${me.nodename}/${me.type}/${me.vmid}/${endpoint}`;
            },
        };
    },

    cbind: {
        title: (get) => (get('isQemu') ? gettext('Reassign Disk') : gettext('Reassign Volume')),
        submitText: (get) => get('title'),
        qemu: '{isQemu}',
        url: '{url}',
    },

    getValues: function () {
        let me = this;
        let values = me.formPanel.getForm().getValues();

        let params = {
            vmid: me.vmid,
            'target-vmid': values.targetVmid,
        };

        params[me.qemu ? 'disk' : 'volume'] = me.disk;

        if (me.qemu) {
            params['target-disk'] = `${values.controller}${values.deviceid}`;
        } else {
            params['target-volume'] = `${values.mpType}${values.mpId}`;
        }
        return params;
    },

    controller: {
        xclass: 'Ext.app.ViewController',

        initViewModel: function (model) {
            let view = this.getView();
            let mpTypeValue = view.disk.match(/^unused\d+/) ? 'unused' : 'mp';
            model.set('mpType', mpTypeValue);
        },

        onMpTypeChange: function (value) {
            let view = this.getView();
            view.getViewModel().set('mpType', value.getValue());
            view.lookup('mpIdSelector').validate();
        },

        onTargetVMChange: function (f, vmid) {
            let me = this;
            let view = me.getView();
            let diskSelector = view.lookup('diskSelector');
            if (!vmid) {
                diskSelector.setVMConfig(null);
                me.VMConfig = null;
                return;
            }

            let url = `/nodes/${view.nodename}/${view.type}/${vmid}/config`;
            Proxmox.Utils.API2Request({
                url: url,
                method: 'GET',
                failure: (response) => Ext.Msg.alert(gettext('Error'), response.htmlStatus),
                success: function ({ result }, options) {
                    if (view.qemu) {
                        diskSelector.setVMConfig(result.data);
                        diskSelector.setDisabled(false);
                    } else {
                        let mpIdSelector = view.lookup('mpIdSelector');
                        let mpType = view.lookup('mpType');

                        view.VMConfig = result.data;

                        mpIdSelector.setValue(
                            PVE.Utils.nextFreeLxcMP(
                                view.getViewModel().get('mpType'),
                                view.VMConfig,
                            ).id,
                        );

                        mpType.setDisabled(false);
                        mpIdSelector.setDisabled(false);
                        mpIdSelector.validate();
                    }
                },
            });
        },
    },

    defaultFocus: 'sourceDisk',
    items: [
        {
            xtype: 'displayfield',
            name: 'sourceDisk',
            fieldLabel: gettext('Source'),
            cbind: {
                name: (get) => (get('isQemu') ? 'disk' : 'volume'),
                value: '{disk}',
            },
            allowBlank: false,
        },
        {
            xtype: 'vmComboSelector',
            name: 'targetVmid',
            allowBlank: false,
            fieldLabel: gettext('Target Guest'),
            store: {
                model: 'PVEResources',
                autoLoad: true,
                sorters: 'vmid',
                cbind: {}, // for nested cbinds
                filters: [
                    {
                        property: 'type',
                        cbind: { value: '{type}' },
                    },
                    {
                        property: 'node',
                        cbind: { value: '{nodename}' },
                    },
                    // FIXME: remove, artificial restriction that doesn't gains us anything..
                    {
                        property: 'vmid',
                        operator: '!=',
                        cbind: { value: '{vmid}' },
                    },
                    {
                        property: 'template',
                        value: 0,
                    },
                ],
            },
            listeners: { change: 'onTargetVMChange' },
        },
        {
            xtype: 'pveControllerSelector',
            reference: 'diskSelector',
            withUnused: true,
            disabled: true,
            cbind: {
                hidden: '{!isQemu}',
            },
        },
        {
            xtype: 'container',
            layout: 'hbox',
            cbind: {
                hidden: '{isQemu}',
                disabled: '{isQemu}',
            },
            items: [
                {
                    xtype: 'pmxDisplayEditField',
                    cbind: {
                        editable: (get) => !get('disk').match(/^unused\d+/),
                        value: (get) => (get('disk').match(/^unused\d+/) ? 'unused' : 'mp'),
                    },
                    disabled: true,
                    name: 'mpType',
                    reference: 'mpType',
                    fieldLabel: gettext('Add as'),
                    submitValue: true,
                    flex: 4,
                    editConfig: {
                        xtype: 'proxmoxKVComboBox',
                        name: 'mpTypeCombo',
                        deleteEmpty: false,
                        cbind: {
                            hidden: '{isQemu}',
                        },
                        comboItems: [
                            ['mp', gettext('Mount Point')],
                            ['unused', gettext('Unused')],
                        ],
                        listeners: { change: 'onMpTypeChange' },
                    },
                },
                {
                    xtype: 'proxmoxintegerfield',
                    name: 'mpId',
                    reference: 'mpIdSelector',
                    minValue: 0,
                    flex: 1,
                    allowBlank: false,
                    validateOnChange: true,
                    disabled: true,
                    bind: {
                        maxValue: '{mpMaxCount}',
                    },
                    validator: function (value) {
                        let view = this.up('window');
                        let type = view.getViewModel().get('mpType');
                        if (Ext.isDefined(view.VMConfig[`${type}${value}`])) {
                            return 'Mount point is already in use.';
                        }
                        return true;
                    },
                },
            ],
        },
    ],

    initComponent: function () {
        let me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        if (!me.vmid) {
            throw 'no VM ID specified';
        }

        if (!me.type) {
            throw 'no type specified';
        }

        me.callParent();
    },
});
