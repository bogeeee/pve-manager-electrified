Ext.define('PVE.sdn.VnetInputPanel', {
    extend: 'Proxmox.panel.InputPanel',
    mixins: ['Proxmox.Mixin.CBind'],

    onGetValues: function (values) {
        let me = this;

        if (me.isCreate) {
            values.type = 'vnet';
            return values;
        }

        // Fields disabled because the selected zone does not support them are excluded from
        // getSubmitData, so deleteEmpty cannot fire for them. Explicitly stage a delete so a
        // previously persisted value gets dropped instead of left behind in the config.
        let addDelete = (key) => {
            if (values.delete) {
                if (Ext.isArray(values.delete)) {
                    values.delete.push(key);
                } else {
                    values.delete = [values.delete, key];
                }
            } else {
                values.delete = [key];
            }
            delete values[key];
        };

        if (me.down('#sdnVnetTagField').isDisabled()) {
            addDelete('tag');
        }
        if (me.down('#sdnVnetVlanAwareField').isDisabled()) {
            addDelete('vlanaware');
        }

        return values;
    },

    initComponent: function () {
        let me = this;

        me.callParent();
        me.setZoneType(undefined);
    },

    items: [
        {
            xtype: 'pmxDisplayEditField',
            name: 'vnet',
            cbind: {
                editable: '{isCreate}',
            },
            maxLength: 8,
            flex: 1,
            allowBlank: false,
            fieldLabel: gettext('Name'),
        },
        {
            xtype: 'proxmoxtextfield',
            name: 'alias',
            fieldLabel: gettext('Alias'),
            allowBlank: true,
            skipEmptyText: true,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
        {
            xtype: 'pveSDNZoneSelector',
            fieldLabel: gettext('Zone'),
            name: 'zone',
            value: '',
            allowBlank: false,
            listeners: {
                change: function () {
                    let me = this;

                    let record = me.findRecordByValue(me.value);
                    let zoneType = record?.data?.type;

                    let panel = me.up('panel');
                    panel.setZoneType(zoneType);
                },
            },
        },
        {
            xtype: 'proxmoxintegerfield',
            itemId: 'sdnVnetTagField',
            name: 'tag',
            minValue: 1,
            maxValue: 16777216,
            fieldLabel: gettext('Tag'),
            allowBlank: true,
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
    ],
    advancedItems: [
        {
            xtype: 'proxmoxcheckbox',
            name: 'isolate-ports',
            uncheckedValue: null,
            checked: false,
            fieldLabel: gettext('Isolate Ports'),
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
        {
            xtype: 'proxmoxcheckbox',
            itemId: 'sdnVnetVlanAwareField',
            name: 'vlanaware',
            uncheckedValue: null,
            checked: false,
            fieldLabel: gettext('VLAN Aware'),
            cbind: {
                deleteEmpty: '{!isCreate}',
            },
        },
    ],

    setZoneType: function (zoneType) {
        let me = this;

        let tagField = me.down('#sdnVnetTagField');
        if (!zoneType || zoneType === 'simple') {
            tagField.setDisabled(true);
            tagField.setValue('');
            tagField.allowBlank = true;
        } else {
            tagField.setDisabled(false);
            // vlan, vxlan and evpn zones require a tag; qinq and faucet allow tag-less vnets.
            tagField.allowBlank = zoneType === 'qinq' || zoneType === 'faucet';
        }
        tagField.validate();

        let vlanField = me.down('#sdnVnetVlanAwareField');
        if (!zoneType || zoneType === 'evpn') {
            vlanField.setDisabled(true);
            vlanField.setValue('');
        } else {
            vlanField.setDisabled(false);
        }
    },
});

Ext.define('PVE.sdn.VnetEdit', {
    extend: 'Proxmox.window.Edit',

    subject: gettext('VNet'),

    vnet: undefined,

    width: 350,

    initComponent: function () {
        var me = this;

        me.isCreate = me.vnet === undefined;

        if (me.isCreate) {
            me.url = '/api2/extjs/cluster/sdn/vnets';
            me.method = 'POST';
        } else {
            me.url = '/api2/extjs/cluster/sdn/vnets/' + me.vnet;
            me.method = 'PUT';
        }

        let ipanel = Ext.create('PVE.sdn.VnetInputPanel', {
            isCreate: me.isCreate,
        });

        Ext.apply(me, {
            items: [ipanel],
        });

        me.callParent();

        if (!me.isCreate) {
            me.load({
                success: function (response, options) {
                    let values = response.result.data;
                    ipanel.setValues(values);
                },
            });
        }
    },
});
